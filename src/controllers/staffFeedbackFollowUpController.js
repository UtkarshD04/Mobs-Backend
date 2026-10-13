import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import FeedbackFollowUp, { FOLLOW_UP_TYPES } from '../models/FeedbackFollowUp.js'
import { NOTE_MAX, validateMessage } from '../utils/rejectionFeedback.js'
import { NOTIFY_COOLDOWN_HOURS, canNotifyAgain, stillOutstanding, syncFollowUps } from '../utils/feedbackFollowUps.js'
import { notifyCompany } from '../utils/rejectionFeedbackService.js'
import Application from '../models/Application.js'
import { logger } from '../config/logger.js'

// Cases where Mzobs is waiting on an employer. Admin-only (mounted behind requireStaffAuth
// + requireAdmin). Every action is recorded on the case, and nothing here can approve,
// edit or delete the feedback itself.

const fail = (res, status, message, code, extra = {}) => res.status(status).json({ ...(code ? { code } : {}), message, ...extra })
const isId = (value) => typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value)
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const COPY = {
  missing_feedback: (c) => ({ title: 'Rejection reason needed', body: `Please add the reason you rejected ${c.candidateName || 'a candidate'}${c.jobTitle ? ` for ${c.jobTitle}` : ''}. Open the candidate and use the Rejected action.` }),
  returned_unanswered: (c) => ({ title: 'Rejection feedback needs an update', body: `Mzobs is waiting for your updated feedback on ${c.candidateName || 'a candidate'}. Open Feedback follow-ups to respond.` }),
  clarification_pending: (c) => ({ title: 'Rejection feedback needs an update', body: `A clarification about ${c.candidateName || 'a candidate'} is waiting for your reply. Open Feedback follow-ups to respond.` }),
}

async function applicationStatusMap(rows) {
  const ids = rows.map((r) => r.application).filter(Boolean)
  const apps = await Application.find({ _id: { $in: ids } }).select('status')
  return new Map(apps.map((a) => [String(a._id), a.status]))
}

function item(row, applicationStatus) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    candidateName: row.candidateName,
    applicationId: row.application ? String(row.application) : null,
    applicationStatus: applicationStatus ?? null,
    companyName: row.companyName,
    jobTitle: row.jobTitle,
    contact: { name: row.contactName, email: row.contactEmail },
    outstandingAction: row.outstandingAction,
    dueSince: row.dueSince,
    lastContactedAt: row.lastContactedAt,
    lastNotifiedAt: row.lastNotifiedAt,
    nextFollowUpAt: row.nextFollowUpAt,
    canNotify: row.status === 'open' && canNotifyAgain(row),
    attempts: row.attempts.map((a) => ({ kind: a.kind, channel: a.channel, ok: a.ok, error: a.error || null, note: a.note, byName: a.byName, at: a.at })),
    notes: row.notes.map((n) => ({ text: n.text, byName: n.byName, at: n.at })),
    completedAt: row.completedAt ?? null,
    autoCompleted: row.autoCompleted,
  }
}

// GET /api/staff/rejection-feedback/follow-ups?status=open|completed&q=&page=&limit=
export const listFollowUps = asyncHandler(async (req, res) => {
  await syncFollowUps().catch((err) => logger.warn({ err }, 'Follow-up sync failed'))
  const filter = { status: req.query.status === 'completed' ? 'completed' : 'open' }
  if (req.query.type) {
    if (!FOLLOW_UP_TYPES.includes(req.query.type)) return fail(res, 400, 'Unknown follow-up type')
    filter.type = req.query.type
  }
  if (typeof req.query.q === 'string' && req.query.q.trim()) {
    const rx = new RegExp(escapeRegex(req.query.q.trim().slice(0, 80)), 'i')
    filter.$or = [{ candidateName: rx }, { companyName: rx }, { jobTitle: rx }]
  }
  const { data, page, limit, total } = await paginate(FeedbackFollowUp, filter, paginationParams(req), { sort: { nextFollowUpAt: 1, dueSince: 1 } })
  setPaginationHeaders(res, { page, limit, total })
  const statuses = await applicationStatusMap(data)
  res.json(data.map((row) => item(row, statuses.get(String(row.application)))))
})

const load = async (req, res) => {
  if (!isId(req.params.id)) {
    fail(res, 404, 'Follow-up not found')
    return null
  }
  const row = await FeedbackFollowUp.findById(req.params.id)
  if (!row) fail(res, 404, 'Follow-up not found')
  return row
}
const actor = (staff) => ({ by: String(staff._id), byName: staff.name ?? '' })

// POST /:id/notify — nudges the employer through the existing notification service.
// The attempt is claimed atomically against a cooldown, so a double click or a repeat
// can never send the employer two messages; the delivery result is recorded either way.
export const notifyEmployerFollowUp = asyncHandler(async (req, res) => {
  const row = await load(req, res)
  if (!row) return
  if (row.status !== 'open') return fail(res, 409, 'This follow-up is already complete.', 'FOLLOW_UP_CLOSED')

  const cutoff = new Date(Date.now() - NOTIFY_COOLDOWN_HOURS * 3600 * 1000)
  const claimed = await FeedbackFollowUp.findOneAndUpdate(
    { _id: row._id, status: 'open', $or: [{ lastNotifiedAt: null }, { lastNotifiedAt: { $lte: cutoff } }] },
    { $set: { lastNotifiedAt: new Date() } },
    { new: false }
  )
  if (!claimed) {
    return fail(res, 429, `The employer was already notified recently. You can send another after ${NOTIFY_COOLDOWN_HOURS} hours.`, 'FOLLOW_UP_RECENTLY_SENT', {
      nextAllowedAt: new Date((row.lastNotifiedAt?.getTime?.() ?? Date.now()) + NOTIFY_COOLDOWN_HOURS * 3600 * 1000),
    })
  }

  const ok = await notifyCompany(row.company, COPY[row.type](row))
  const attempt = { kind: 'notification', channel: 'in_app', ok, error: ok ? '' : 'Delivery failed', ...actor(req.staff), at: new Date() }
  // A failed send must not use up the cooldown, so the staff member can try again.
  await FeedbackFollowUp.updateOne(
    { _id: row._id },
    { $push: { attempts: attempt }, $set: ok ? { lastContactedAt: attempt.at } : { lastNotifiedAt: claimed.lastNotifiedAt } }
  )
  res.status(ok ? 200 : 502).json({ ok, ...(ok ? {} : { message: 'The notification could not be delivered. Try again.' }) })
})

// POST /:id/contact { channel, note } — a call, email or message made outside the system.
export const recordContact = asyncHandler(async (req, res) => {
  const row = await load(req, res)
  if (!row) return
  if (row.status !== 'open') return fail(res, 409, 'This follow-up is already complete.', 'FOLLOW_UP_CLOSED')
  const channel = ['phone', 'email', 'other'].includes(req.body?.channel) ? req.body.channel : null
  if (!channel) return fail(res, 400, 'channel must be phone, email or other')
  const { value: note, error } = validateMessage(req.body?.note, { min: 3, max: NOTE_MAX, label: 'note about the contact' })
  if (error) return fail(res, 400, error)
  const at = new Date()
  await FeedbackFollowUp.updateOne({ _id: row._id }, { $push: { attempts: { kind: 'contact', channel, ok: true, note, ...actor(req.staff), at } }, $set: { lastContactedAt: at } })
  res.status(201).json({ ok: true })
})

// POST /:id/notes { text } — internal note.
export const addFollowUpNote = asyncHandler(async (req, res) => {
  const row = await load(req, res)
  if (!row) return
  const { value, error } = validateMessage(req.body?.text, { min: 3, max: NOTE_MAX, label: 'note' })
  if (error) return fail(res, 400, error)
  await FeedbackFollowUp.updateOne({ _id: row._id }, { $push: { notes: { text: value, ...actor(req.staff), at: new Date() } } })
  res.status(201).json({ ok: true })
})

// PATCH /:id/next { nextFollowUpAt } — null clears it.
export const setNextFollowUp = asyncHandler(async (req, res) => {
  const row = await load(req, res)
  if (!row) return
  if (row.status !== 'open') return fail(res, 409, 'This follow-up is already complete.', 'FOLLOW_UP_CLOSED')
  const raw = req.body?.nextFollowUpAt
  let next = null
  if (raw !== null && raw !== undefined && raw !== '') {
    next = new Date(raw)
    if (Number.isNaN(next.getTime())) return fail(res, 400, 'Choose a valid date.')
    if (next.getTime() < Date.now() - 24 * 3600 * 1000) return fail(res, 400, 'Choose a date that is not in the past.')
  }
  await FeedbackFollowUp.updateOne({ _id: row._id }, { $set: { nextFollowUpAt: next } })
  res.json({ nextFollowUpAt: next })
})

// POST /:id/complete — only once the employer has actually done what was outstanding.
export const completeFollowUp = asyncHandler(async (req, res) => {
  const row = await load(req, res)
  if (!row) return
  if (row.status !== 'open') return fail(res, 409, 'This follow-up is already complete.', 'FOLLOW_UP_CLOSED')
  if (await stillOutstanding(row)) {
    return fail(res, 409, 'The employer has not completed the required action yet, so this can’t be marked complete.', 'ACTION_NOT_VERIFIED')
  }
  const done = await FeedbackFollowUp.findOneAndUpdate({ _id: row._id, status: 'open' }, { $set: { status: 'completed', completedAt: new Date(), completedBy: String(req.staff._id) } }, { new: true })
  if (!done) return fail(res, 409, 'This follow-up is already complete.', 'FOLLOW_UP_CLOSED')
  res.json({ id: done.id, status: done.status })
})

