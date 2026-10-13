import mongoose from 'mongoose'
import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import RejectionFeedback from '../models/RejectionFeedback.js'
import Application from '../models/Application.js'
import StaffUser from '../models/StaffUser.js'
import FeedbackFollowUp from '../models/FeedbackFollowUp.js'
import {
  FEEDBACK_REASONS,
  FEEDBACK_STAGES,
  FEEDBACK_STATUSES,
  NOTE_MAX,
  RETURN_REASONS,
  canRetryNotification,
  draftSummary,
  improvementAreasFor,
  latestApprovedVersion,
  reasonLabels,
  validateMessage,
  validateReturn,
  validateReviewSummary,
} from '../utils/rejectionFeedback.js'
import { actorOf, backfillSnapshots, deliverCandidateNotification, notifyCompany, recordAudit, transition } from '../utils/rejectionFeedbackService.js'
import { syncFollowUps } from '../utils/feedbackFollowUps.js'
import { logger } from '../config/logger.js'

// Reviewer tools. Mounted behind requireStaffAuth + requireAdmin, so only an admin can
// read employer remarks or decide what a candidate sees.

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const isId = (value) => typeof value === 'string' && mongoose.isValidObjectId(value) && /^[0-9a-f]{24}$/i.test(value)
const fail = (res, status, message, code) => res.status(status).json({ ...(code ? { code } : {}), message })
const stale = (res) => fail(res, 409, 'This feedback changed since you opened it. Refresh and review again.', 'FEEDBACK_STATE_CHANGED')

function listItem(row) {
  const version = latestApprovedVersion(row)
  return {
    id: row.id,
    status: row.status,
    rev: row.rev,
    stage: row.stage,
    stageLabel: FEEDBACK_STAGES[row.stage] ?? null,
    outcome: row.outcome,
    reasons: reasonLabels(row.reasons),
    employerFeedback: row.employerRemarks ?? '',
    candidateName: row.candidateName,
    applicationId: String(row.application),
    jobTitle: row.jobTitle,
    companyName: row.companyName,
    rejectedAt: row.rejectedAt ?? row.createdAt,
    submittedAt: row.createdAt,
    updatedAt: row.updatedAt,
    returnReason: row.clarification?.message ?? null,
    returnedAt: row.clarification?.requestedAt ?? null,
    flaggedAt: row.flag?.at ?? null,
    dispute: row.dispute?.status ? { status: row.dispute.status, raisedAt: row.dispute.raisedAt } : null,
    approvedAt: version?.approvedAt ?? null,
    approvedByName: version?.approvedByName ?? null,
    version: version?.number ?? null,
    notification: row.notification?.status ? { status: row.notification.status, attempts: row.notification.attempts, sentAt: row.notification.sentAt ?? null, error: row.notification.error || null } : null,
  }
}

const STATUS_QUERIES = { attention: { $in: ['flagged', 'disputed'] } }

// Builds the Mongo filter from the request's query string. Every id is validated and every
// text term escaped, so nothing from the client reaches the query as an operator.
export function buildListFilter(query) {
  const filter = {}
  const { status, q, company, job, stage, from, to } = query

  if (status !== undefined && status !== '') {
    if (STATUS_QUERIES[status]) filter.status = STATUS_QUERIES[status]
    else if (FEEDBACK_STATUSES.includes(status)) filter.status = status
    else return { error: 'Unknown status filter' }
  }
  if (company) {
    if (!isId(company)) return { error: 'Invalid company filter' }
    filter.company = company
  }
  if (job) {
    if (!isId(job)) return { error: 'Invalid job filter' }
    filter.job = job
  }
  if (stage) {
    if (!Object.hasOwn(FEEDBACK_STAGES, stage)) return { error: 'Unknown stage filter' }
    filter.stage = stage
  }
  const range = {}
  for (const [key, op] of [[from, '$gte'], [to, '$lte']]) {
    if (!key) continue
    const date = new Date(key)
    if (Number.isNaN(date.getTime())) return { error: 'Invalid date filter' }
    if (op === '$lte') date.setHours(23, 59, 59, 999)
    range[op] = date
  }
  if (Object.keys(range).length) filter.createdAt = range

  if (typeof q === 'string' && q.trim()) {
    const term = q.trim().slice(0, 80)
    if (isId(term)) filter.$or = [{ application: term }, { _id: term }]
    else {
      const rx = new RegExp(escapeRegex(term), 'i')
      filter.$or = [{ candidateName: rx }, { companyName: rx }, { jobTitle: rx }]
    }
  }
  return { filter }
}

// GET /api/staff/rejection-feedback — the queue. Server-side filter, search and pagination.
export const listFeedback = asyncHandler(async (req, res) => {
  const { filter, error } = buildListFilter(req.query)
  if (error) return fail(res, 400, error)

  // Records saved before the search fields existed get them filled in (bounded, idempotent).
  await backfillSnapshots().catch((err) => logger.warn({ err }, 'Rejection feedback: snapshot backfill failed'))

  const { data, page, limit, total } = await paginate(RejectionFeedback, filter, paginationParams(req), { sort: { updatedAt: -1 }, select: '+employerRemarks' })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data.map(listItem))
})

// GET /api/staff/rejection-feedback/counts — tab and card badges, straight from the database.
// Employer follow-up counts open cases (after opening any that have become overdue).
export const feedbackCounts = asyncHandler(async (_req, res) => {
  await syncFollowUps().catch((err) => logger.warn({ err }, 'Rejection feedback: follow-up sync failed'))
  const [rows, followUp] = await Promise.all([RejectionFeedback.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]), FeedbackFollowUp.countDocuments({ status: 'open' })])
  const counts = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0]))
  for (const row of rows) counts[row._id] = row.count
  res.json({ ...counts, attention: counts.flagged + counts.disputed, followUp })
})

// GET /api/staff/rejection-feedback/filters — the companies and jobs that actually have feedback.
export const feedbackFilters = asyncHandler(async (_req, res) => {
  const [companies, jobs] = await Promise.all([
    RejectionFeedback.aggregate([{ $group: { _id: '$company', name: { $first: '$companyName' } } }, { $sort: { name: 1 } }, { $limit: 200 }]),
    RejectionFeedback.aggregate([{ $match: { job: { $ne: null } } }, { $group: { _id: '$job', title: { $first: '$jobTitle' }, company: { $first: '$company' } } }, { $sort: { title: 1 } }, { $limit: 300 }]),
  ])
  res.json({
    companies: companies.map((c) => ({ id: String(c._id), name: c.name })),
    jobs: jobs.map((j) => ({ id: String(j._id), title: j.title, companyId: String(j.company) })),
    stages: Object.entries(FEEDBACK_STAGES).map(([code, label]) => ({ code, label })),
    returnReasons: Object.entries(RETURN_REASONS).map(([code, label]) => ({ code, label })),
  })
})

const loadFull = (id) => RejectionFeedback.findById(id).select('+employerRemarks +submissions +audit +notes +flag.reason +dispute.reason +dispute.resolutionSummary').populate('submittedBy', 'name role')

// Has this reviewer opened the current submission (or dispute) since it last changed?
function hasViewed(row, staffId) {
  const since = Math.max(row.submissions?.at(-1)?.at?.getTime?.() ?? row.createdAt.getTime(), row.dispute?.raisedAt?.getTime?.() ?? 0)
  return row.audit.some((a) => a.action === 'viewed' && a.actorId === staffId && a.at.getTime() >= since)
}

async function namesFor(ids) {
  const staff = await StaffUser.find({ _id: { $in: ids.filter(isId) } }).select('name')
  return new Map(staff.map((s) => [String(s._id), s.name]))
}

// GET /api/staff/rejection-feedback/:id — full record: employer's submission, history,
// internal notes and the audit trail. Opening it is itself recorded, because approving
// requires the reviewer to have read it.
export const getFeedback = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, 'Feedback not found')
  const row = await loadFull(req.params.id)
  if (!row) return fail(res, 404, 'Feedback not found')
  const staffId = String(req.staff._id)

  if (!hasViewed(row, staffId)) {
    await RejectionFeedback.updateOne({ _id: row._id }, { $push: { audit: { action: 'viewed', actorType: 'staff', actorId: staffId, actorName: req.staff.name ?? '', at: new Date() } } })
    row.audit.push({ action: 'viewed', actorType: 'staff', actorId: staffId, actorName: req.staff.name ?? '', at: new Date() })
  }

  const [application, names] = await Promise.all([
    Application.findById(row.application).select('status appliedOn statusHistory'),
    namesFor([...row.audit.map((a) => a.actorId), ...row.notes.map((n) => n.by)]),
  ])
  const name = (id, fallback = '') => names.get(id) ?? fallback
  const latest = latestApprovedVersion(row)

  res.json({
    ...listItem(row),
    application: application
      ? { id: String(application._id), status: application.status, appliedOn: application.appliedOn, timeline: application.statusHistory.map((h) => ({ status: h.status, at: h.changedOn })) }
      : null,
    reasonDetails: row.reasons.map((code) => ({ code, label: FEEDBACK_REASONS[code]?.label ?? code, category: FEEDBACK_REASONS[code]?.category })),
    employerRemarks: row.employerRemarks,
    submittedBy: row.submittedBy ? { name: row.submittedBy.name, role: row.submittedBy.role } : null,
    submissions: row.submissions.map((s) => ({ revision: s.revision, stage: s.stage, stageLabel: FEEDBACK_STAGES[s.stage], reasons: reasonLabels(s.reasons), remarks: s.remarks, at: s.at })),
    // What the candidate would receive if approved right now, built only from the structured reasons.
    draft: { summary: draftSummary(row.reasons, row.stage), reasons: reasonLabels(row.reasons), improvementAreas: improvementAreasFor(row.reasons) },
    versions: row.versions,
    delivered: latest ? { version: latest.number, summary: latest.summary, reasons: latest.reasons, improvementAreas: latest.improvementAreas, approvedAt: latest.approvedAt, approvedByName: latest.approvedByName } : null,
    clarification: row.clarification?.message ? { kind: row.clarification.kind, reason: row.clarification.reason, message: row.clarification.message, requestedAt: row.clarification.requestedAt } : null,
    flag: row.flag?.at ? { reason: row.flag.reason, at: row.flag.at, by: name(row.flag.by) } : null,
    dispute: row.dispute?.status
      ? { status: row.dispute.status, reason: row.dispute.reason, raisedAt: row.dispute.raisedAt, version: row.dispute.version, resolvedAt: row.dispute.resolvedAt ?? null, resolvedBy: name(row.dispute.resolvedBy), resolutionAction: row.dispute.resolutionAction ?? null, resolutionSummary: row.dispute.resolutionSummary ?? null }
      : null,
    notes: row.notes.map((n) => ({ text: n.text, by: name(n.by, n.byName), at: n.at })),
    audit: row.audit.filter((a) => a.action !== 'viewed').map((a) => ({ action: a.action, actorType: a.actorType, actor: a.actorType === 'staff' ? name(a.actorId, a.actorName) : a.actorName, fromStatus: a.fromStatus, toStatus: a.toStatus, note: a.note, at: a.at })),
    viewedByYou: true,
  })
})

async function approve(row, staff, summaryInput, rev, kind) {
  const { value: summary, error } = validateReviewSummary(summaryInput)
  if (error) return { error }

  const number = (latestApprovedVersion(row)?.number ?? 0) + 1
  const version = {
    number,
    summary,
    reasons: reasonLabels(row.reasons),
    improvementAreas: improvementAreasFor(row.reasons),
    approvedBy: String(staff._id),
    approvedByName: staff.name ?? '',
    approvedAt: new Date(),
  }
  const set = { status: 'approved', notification: { status: 'pending', version: number, attempts: 0 } }
  if (row.dispute?.status === 'open' || row.dispute?.status === 'investigating') {
    set['dispute.status'] = 'resolved'
    set['dispute.resolvedAt'] = new Date()
    set['dispute.resolvedBy'] = String(staff._id)
    set['dispute.resolutionAction'] = kind === 'revised' ? 'revised' : 'approved'
  }
  const updated = await transition(
    row._id,
    ['pending_review', 'disputed'],
    set,
    { ...actorOf(staff), action: kind === 'revised' ? 'revised_after_dispute' : 'approved', fromStatus: row.status, toStatus: 'approved', note: `version ${number}` },
    { $push: { versions: version }, $unset: { clarification: '', flag: '' } },
    { rev }
  )
  return { updated }
}

// POST /api/staff/rejection-feedback/:id/review
//   { action: 'approve', rev, summary }
//   { action: 'return', rev, returnReason, message? }
//   { action: 'flag', rev, internalReason }
//   { action: 'clear_flag', rev, note? }
export const reviewFeedback = asyncHandler(async (req, res) => {
  const { action, summary, message, returnReason, internalReason, note } = req.body ?? {}
  const rev = Number.isInteger(req.body?.rev) ? req.body.rev : undefined
  if (!['approve', 'return', 'flag', 'clear_flag'].includes(action)) return fail(res, 400, 'action must be approve, return, flag or clear_flag')
  if (rev === undefined) return fail(res, 400, 'rev is required so a stale review can be refused', 'REV_REQUIRED')
  if (!isId(req.params.id)) return fail(res, 404, 'Feedback not found')

  const row = await loadFull(req.params.id)
  if (!row) return fail(res, 404, 'Feedback not found')
  if (row.rev !== rev) return stale(res)
  const staff = req.staff

  if (action === 'approve') {
    if (row.status !== 'pending_review') return stale(res)
    if (!hasViewed(row, String(staff._id))) return fail(res, 400, 'Open and read the employer’s submission before approving it.', 'REVIEW_REQUIRED')
    const { updated, error } = await approve(row, staff, summary ?? draftSummary(row.reasons, row.stage), rev, 'approved')
    if (error) return fail(res, 400, error)
    if (!updated) return stale(res)
    const delivery = await deliverCandidateNotification(updated._id, { kind: 'approved', staff })
    return res.json({ id: updated.id, status: updated.status, rev: updated.rev + (delivery.skipped ? 0 : 0), notification: delivery.status ?? 'sent' })
  }

  if (action === 'return') {
    if (!['pending_review', 'flagged'].includes(row.status)) return stale(res)
    const { value, error } = validateReturn({ returnReason, message })
    if (error) return fail(res, 400, error)
    const updated = await transition(
      row._id,
      ['pending_review', 'flagged'],
      { status: 'returned', clarification: { kind: 'returned', reason: value.returnReason, message: value.text, requestedAt: new Date() } },
      { ...actorOf(staff), action: 'returned', fromStatus: row.status, toStatus: 'returned', note: value.text },
      { $unset: { flag: '' } },
      { rev }
    )
    if (!updated) return stale(res)
    const notified = await notifyCompany(row.company, { title: 'Rejection feedback needs an update', body: `Mzobs asked for more detail on the feedback for ${row.candidateName || 'a candidate'}. Open Feedback follow-ups to respond.` })
    await recordAudit(row._id, { ...actorOf(staff), action: notified ? 'employer_notified' : 'employer_notification_failed' })
    return res.json({ id: updated.id, status: updated.status, rev: updated.rev + 1 })
  }

  if (action === 'flag') {
    if (row.status !== 'pending_review') return stale(res)
    const { value, error } = validateMessage(internalReason, { min: 10, label: 'internal reason for flagging' })
    if (error) return fail(res, 400, error)
    const updated = await transition(
      row._id,
      ['pending_review'],
      { status: 'flagged', flag: { reason: value, at: new Date(), by: String(staff._id) } },
      { ...actorOf(staff), action: 'flagged', fromStatus: 'pending_review', toStatus: 'flagged', note: value },
      {},
      { rev }
    )
    if (!updated) return stale(res)
    return res.json({ id: updated.id, status: updated.status, rev: updated.rev })
  }

  // clear_flag
  if (row.status !== 'flagged') return stale(res)
  const updated = await transition(
    row._id,
    ['flagged'],
    { status: 'pending_review' },
    { ...actorOf(staff), action: 'flag_cleared', fromStatus: 'flagged', toStatus: 'pending_review', note: typeof note === 'string' ? note.trim().slice(0, 300) : '' },
    { $unset: { flag: '' } },
    { rev }
  )
  if (!updated) return stale(res)
  res.json({ id: updated.id, status: updated.status, rev: updated.rev })
})

// POST /api/staff/rejection-feedback/:id/notes { text } — private reviewer note.
export const addNote = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, 'Feedback not found')
  const { value, error } = validateMessage(req.body?.text, { min: 3, max: NOTE_MAX, label: 'note' })
  if (error) return fail(res, 400, error)
  const updated = await RejectionFeedback.findOneAndUpdate(
    { _id: req.params.id },
    { $push: { notes: { text: value, by: String(req.staff._id), byName: req.staff.name ?? '', at: new Date() }, audit: { ...actorOf(req.staff), action: 'note_added', at: new Date() } } },
    { new: true }
  )
  if (!updated) return fail(res, 404, 'Feedback not found')
  res.status(201).json({ ok: true })
})

// POST /api/staff/rejection-feedback/:id/retry-notification — only when delivery failed or
// never completed. Claims the attempt atomically and carries an idempotency key, so
// double clicks and repeated retries can never message the candidate twice.
export const retryNotification = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return fail(res, 404, 'Feedback not found')
  const row = await RejectionFeedback.findById(req.params.id)
  if (!row) return fail(res, 404, 'Feedback not found')
  if (!latestApprovedVersion(row)) return fail(res, 409, 'Nothing has been approved yet.', 'NOT_APPROVED')
  if (!canRetryNotification(row.notification)) return fail(res, 409, 'The candidate has already been notified.', 'ALREADY_DELIVERED')
  const result = await deliverCandidateNotification(row._id, { kind: row.dispute?.resolutionAction === 'revised' ? 'revised' : 'approved', staff: req.staff })
  if (result.skipped) return fail(res, 409, 'The candidate has already been notified.', 'ALREADY_DELIVERED')
  res.status(result.sent ? 200 : 502).json({ status: result.status, ...(result.error ? { error: result.error } : {}) })
})

// POST /api/staff/rejection-feedback/:id/resolve-dispute
//   { action: 'resolve', rev, resolutionSummary } | { action: 'revise', rev, summary, resolutionSummary }
//   | { action: 'return', rev, returnReason, message? } | { action: 'investigate', rev, note }
export const resolveDispute = asyncHandler(async (req, res) => {
  const { action, summary, message, returnReason, note, resolutionSummary } = req.body ?? {}
  const rev = Number.isInteger(req.body?.rev) ? req.body.rev : undefined
  if (!['resolve', 'revise', 'return', 'investigate'].includes(action)) return fail(res, 400, 'action must be resolve, revise, return or investigate')
  if (rev === undefined) return fail(res, 400, 'rev is required so a stale review can be refused', 'REV_REQUIRED')
  if (!isId(req.params.id)) return fail(res, 404, 'Feedback not found')

  const row = await loadFull(req.params.id)
  if (!row) return fail(res, 404, 'Feedback not found')
  if (row.status !== 'disputed' || row.rev !== rev) return stale(res)
  const staff = req.staff
  const staffId = String(staff._id)

  if (!hasViewed(row, staffId)) return fail(res, 400, 'Open and read the candidate’s report before deciding.', 'REVIEW_REQUIRED')

  if (action === 'investigate') {
    const { value, error } = validateMessage(note, { min: 10, label: 'investigation note' })
    if (error) return fail(res, 400, error)
    const updated = await RejectionFeedback.findOneAndUpdate(
      { _id: row._id, status: 'disputed', rev },
      { $set: { 'dispute.status': 'investigating' }, $inc: { rev: 1 }, $push: { audit: { ...actorOf(staff), action: 'dispute_under_investigation', fromStatus: 'disputed', toStatus: 'disputed', note: value, at: new Date() } } },
      { new: true }
    )
    if (!updated) return stale(res)
    return res.json({ id: updated.id, status: updated.status, rev: updated.rev })
  }

  if (action === 'return') {
    const { value, error } = validateReturn({ returnReason, message })
    if (error) return fail(res, 400, error)
    const updated = await transition(
      row._id,
      ['disputed'],
      { status: 'returned', clarification: { kind: 'dispute', reason: value.returnReason, message: value.text, requestedAt: new Date() } },
      { ...actorOf(staff), action: 'dispute_returned_to_employer', fromStatus: 'disputed', toStatus: 'returned', note: value.text },
      {},
      { rev }
    )
    if (!updated) return stale(res)
    await notifyCompany(row.company, { title: 'Rejection feedback needs an update', body: `A candidate raised a concern about the feedback for ${row.candidateName || 'a candidate'}. Open Feedback follow-ups to respond.` })
    return res.json({ id: updated.id, status: updated.status, rev: updated.rev })
  }

  const resolution = validateMessage(resolutionSummary, { min: 10, label: 'resolution summary' })
  if (resolution.error) return fail(res, 400, resolution.error)

  if (action === 'revise') {
    const { updated, error } = await approve(row, staff, summary, rev, 'revised')
    if (error) return fail(res, 400, error)
    if (!updated) return stale(res)
    await RejectionFeedback.updateOne({ _id: row._id }, { $set: { 'dispute.resolutionSummary': resolution.value } })
    const delivery = await deliverCandidateNotification(updated._id, { kind: 'revised', staff })
    return res.json({ id: updated.id, status: updated.status, notification: delivery.status ?? 'sent' })
  }

  // resolve: the delivered version stands.
  const updated = await transition(
    row._id,
    ['disputed'],
    { status: 'approved', 'dispute.status': 'resolved', 'dispute.resolvedAt': new Date(), 'dispute.resolvedBy': staffId, 'dispute.resolutionAction': 'upheld', 'dispute.resolutionSummary': resolution.value },
    { ...actorOf(staff), action: 'dispute_resolved', fromStatus: 'disputed', toStatus: 'approved', note: resolution.value },
    {},
    { rev }
  )
  if (!updated) return stale(res)
  res.json({ id: updated.id, status: updated.status, rev: updated.rev })
})
