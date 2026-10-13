import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import RejectionFeedback from '../models/RejectionFeedback.js'
import {
  FEEDBACK_REASONS,
  FEEDBACK_STAGES,
  FEEDBACK_STATUSES,
  draftSummary,
  improvementAreasFor,
  latestApprovedVersion,
  validateMessage,
  validateReviewSummary,
} from '../utils/rejectionFeedback.js'
import { notifyCandidate, transition } from '../utils/rejectionFeedbackService.js'

// Reviewer tools. Mounted behind requireStaffAuth + requireAdmin, so only an admin
// can read employer remarks or decide what a candidate sees.

const POPULATE = [
  { path: 'candidate', select: 'name appliedFor' },
  { path: 'company', select: 'name' },
  { path: 'job', select: 'title' },
]

function listItem(row) {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    stageLabel: FEEDBACK_STAGES[row.stage] ?? null,
    outcome: row.outcome,
    reasons: row.reasons,
    candidateName: row.candidate?.name ?? '',
    jobTitle: row.job?.title ?? row.candidate?.appliedFor ?? '',
    companyName: row.company?.name ?? '',
    disputeOpen: row.dispute?.status === 'open',
    delivered: Boolean(latestApprovedVersion(row)),
    submittedAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// GET /api/staff/rejection-feedback?status=pending_review|approved|returned|flagged|disputed|followUp|attention
export const listFeedback = asyncHandler(async (req, res) => {
  const { status } = req.query
  const query = {}
  if (status === 'followUp') query.status = { $in: ['returned', 'flagged'] } // waiting on the employer
  else if (status === 'attention') query.status = { $in: ['flagged', 'disputed'] } // flagged or reported by a candidate
  else if (FEEDBACK_STATUSES.includes(status)) query.status = status

  const { data, page, limit, total } = await paginate(RejectionFeedback, query, paginationParams(req), { sort: { updatedAt: -1 }, populate: POPULATE })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data.map(listItem))
})

// GET /api/staff/rejection-feedback/counts — tab badges.
export const feedbackCounts = asyncHandler(async (_req, res) => {
  const rows = await RejectionFeedback.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  const counts = Object.fromEntries(FEEDBACK_STATUSES.map((s) => [s, 0]))
  for (const row of rows) counts[row._id] = row.count
  res.json({ ...counts, followUp: counts.returned + counts.flagged, attention: counts.flagged + counts.disputed })
})

// GET /api/staff/rejection-feedback/:id — full record, including the employer's remarks and the audit trail.
export const getFeedback = asyncHandler(async (req, res) => {
  const row = await RejectionFeedback.findById(req.params.id).select('+employerRemarks +audit +dispute.reason').populate(POPULATE)
  if (!row) return res.status(404).json({ message: 'Feedback not found' })
  res.json({
    ...listItem(row),
    employerRemarks: row.employerRemarks,
    reasonDetails: row.reasons.map((code) => ({ code, label: FEEDBACK_REASONS[code]?.label ?? code, category: FEEDBACK_REASONS[code]?.category })),
    draft: { summary: draftSummary(row.reasons, row.stage), improvementAreas: improvementAreasFor(row.reasons) },
    versions: row.versions,
    clarification: row.clarification?.message ? row.clarification : null,
    dispute: row.dispute?.status ? { status: row.dispute.status, reason: row.dispute.reason, raisedAt: row.dispute.raisedAt, resolvedAt: row.dispute.resolvedAt, version: row.dispute.version } : null,
    audit: row.audit,
  })
})

async function approve(row, staffId, summaryInput) {
  const { value: summary, error } = validateReviewSummary(summaryInput)
  if (error) return { error }

  const nextNumber = (latestApprovedVersion(row)?.number ?? 0) + 1
  const version = { number: nextNumber, summary, improvementAreas: improvementAreasFor(row.reasons), approvedBy: staffId, approvedAt: new Date() }
  const set = { status: 'approved' }
  if (row.dispute?.status === 'open') {
    set['dispute.status'] = 'resolved'
    set['dispute.resolvedAt'] = new Date()
  }
  const updated = await transition(
    row._id,
    ['pending_review', 'disputed'],
    set,
    { action: 'approved', actorType: 'staff', actorId: staffId, fromStatus: row.status, toStatus: 'approved', note: `version ${nextNumber}` },
    { $push: { versions: version }, $unset: { clarification: '' } }
  )
  return { updated, version }
}

// POST /api/staff/rejection-feedback/:id/review  { action: 'approve'|'return'|'flag', summary?, message? }
export const reviewFeedback = asyncHandler(async (req, res) => {
  const { action, summary, message } = req.body ?? {}
  if (!['approve', 'return', 'flag'].includes(action)) return res.status(400).json({ message: 'action must be approve, return or flag' })

  const row = await RejectionFeedback.findById(req.params.id).select('+dispute.reason')
  if (!row) return res.status(404).json({ message: 'Feedback not found' })
  const staffId = String(req.staff._id)
  const conflict = () => res.status(409).json({ code: 'FEEDBACK_STATE_CHANGED', message: 'This feedback was already reviewed. Refresh the queue.' })

  if (action === 'approve') {
    const { updated, version, error } = await approve(row, staffId, summary ?? draftSummary(row.reasons, row.stage))
    if (error) return res.status(400).json({ message: error })
    if (!updated) return conflict()
    const notified = await notifyCandidate(row.employee, {
      title: 'Feedback available',
      body: 'The employer’s feedback on your application is now available in My applications.',
    })
    await RejectionFeedback.updateOne({ _id: row._id }, { $push: { audit: { action: notified ? 'candidate_notified' : 'candidate_notification_failed', actorType: 'system', at: new Date(), note: `version ${version.number}` } } })
    return res.json({ id: updated.id, status: updated.status, notified })
  }

  const { value: note, error } = validateMessage(message, { label: action === 'flag' ? 'reason for flagging' : 'clarification request' })
  if (error) return res.status(400).json({ message: error })

  const to = action === 'return' ? 'returned' : 'flagged'
  const updated = await transition(
    row._id,
    ['pending_review', 'disputed'],
    { status: to, clarification: { kind: to, message: note, requestedAt: new Date() } },
    { action: to, actorType: 'staff', actorId: staffId, fromStatus: row.status, toStatus: to, note }
  )
  if (!updated) return conflict()
  res.json({ id: updated.id, status: updated.status })
})

// POST /api/staff/rejection-feedback/:id/resolve-dispute
//   { action: 'uphold' } | { action: 'revise', summary } | { action: 'return', message }
export const resolveDispute = asyncHandler(async (req, res) => {
  const { action, summary, message } = req.body ?? {}
  if (!['uphold', 'revise', 'return'].includes(action)) return res.status(400).json({ message: 'action must be uphold, revise or return' })

  const row = await RejectionFeedback.findById(req.params.id)
  if (!row) return res.status(404).json({ message: 'Feedback not found' })
  if (row.status !== 'disputed') return res.status(409).json({ code: 'FEEDBACK_STATE_CHANGED', message: 'This feedback is not under dispute.' })
  const staffId = String(req.staff._id)

  if (action === 'return') {
    const { value: note, error } = validateMessage(message, { label: 'clarification request' })
    if (error) return res.status(400).json({ message: error })
    const updated = await transition(
      row._id,
      ['disputed'],
      { status: 'returned', clarification: { kind: 'dispute', message: note, requestedAt: new Date() } },
      { action: 'dispute_returned_to_employer', actorType: 'staff', actorId: staffId, fromStatus: 'disputed', toStatus: 'returned', note }
    )
    if (!updated) return res.status(409).json({ code: 'FEEDBACK_STATE_CHANGED', message: 'This feedback was already handled.' })
    return res.json({ id: updated.id, status: updated.status })
  }

  if (action === 'revise') {
    const { updated, error } = await approve(row, staffId, summary)
    if (error) return res.status(400).json({ message: error })
    if (!updated) return res.status(409).json({ code: 'FEEDBACK_STATE_CHANGED', message: 'This feedback was already handled.' })
    const notified = await notifyCandidate(row.employee, { title: 'Feedback updated', body: 'We reviewed your report and updated the feedback on your application.' })
    return res.json({ id: updated.id, status: updated.status, notified })
  }

  // uphold: the delivered version stands.
  const updated = await transition(
    row._id,
    ['disputed'],
    { status: 'approved', 'dispute.status': 'resolved', 'dispute.resolvedAt': new Date() },
    { action: 'dispute_upheld', actorType: 'staff', actorId: staffId, fromStatus: 'disputed', toStatus: 'approved' }
  )
  if (!updated) return res.status(409).json({ code: 'FEEDBACK_STATE_CHANGED', message: 'This feedback was already handled.' })
  const notified = await notifyCandidate(row.employee, { title: 'Your report was reviewed', body: 'We reviewed your report about the feedback on your application and the original feedback stands.' })
  res.json({ id: updated.id, status: updated.status, notified })
})
