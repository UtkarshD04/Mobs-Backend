import { asyncHandler } from '../utils/asyncHandler.js'
import { logActivity } from '../utils/activityLog.js'
import RejectionFeedback from '../models/RejectionFeedback.js'
import { employerCanEdit, toEmployerView, validateSubmission, FEEDBACK_REASONS, FEEDBACK_STAGES } from '../utils/rejectionFeedback.js'
import { notifyReviewers, transition } from '../utils/rejectionFeedbackService.js'

// Everything here is scoped to req.company (set by requireAuth): an employer can
// only ever read or change feedback for candidates shared with their own company.

// GET /api/employer/rejection-feedback — the company's feedback records.
// ?followUp=1 narrows to the ones a reviewer sent back and are waiting on the employer.
export const listFeedback = asyncHandler(async (req, res) => {
  const query = { company: req.company._id }
  if (req.query.followUp === '1') query.status = { $in: ['returned', 'flagged'] }
  else if (typeof req.query.status === 'string' && req.query.status) query.status = req.query.status

  const rows = await RejectionFeedback.find(query).sort({ updatedAt: -1 }).limit(200).populate('candidate', 'name appliedFor')
  res.json(rows.map((row) => ({ ...toEmployerView(row), candidateName: row.candidate?.name ?? '', appliedFor: row.candidate?.appliedFor ?? '' })))
})

// GET /api/employer/rejection-feedback/by-candidate/:candidateId
export const getFeedbackForCandidate = asyncHandler(async (req, res) => {
  const row = await RejectionFeedback.findOne({ candidate: req.params.candidateId, company: req.company._id })
  if (!row) return res.status(404).json({ message: 'No feedback submitted for this candidate' })
  res.json(toEmployerView(row))
})

// PUT /api/employer/rejection-feedback/:id — edit and resubmit after a reviewer
// sent it back or flagged it. Goes back into the review queue.
export const resubmitFeedback = asyncHandler(async (req, res) => {
  const existing = await RejectionFeedback.findOne({ _id: req.params.id, company: req.company._id })
  if (!existing) return res.status(404).json({ message: 'Feedback not found' })
  if (!employerCanEdit(existing.status) || existing.status === 'pending_review') {
    return res.status(409).json({ code: 'FEEDBACK_NOT_EDITABLE', message: 'This feedback is not waiting on you.' })
  }

  const { value, errors } = validateSubmission(req.body)
  if (errors) return res.status(400).json({ message: 'Please fix the highlighted fields.', errors })

  const updated = await transition(
    existing._id,
    ['returned', 'flagged'],
    { stage: value.stage, reasons: value.reasons, outcome: value.outcome, employerRemarks: value.remarks, status: 'pending_review' },
    { action: 'employer_resubmitted', actorType: 'employer', actorId: String(req.user._id), fromStatus: existing.status, toStatus: 'pending_review' },
    { $unset: { clarification: '' } }
  )
  if (!updated) return res.status(409).json({ code: 'FEEDBACK_NOT_EDITABLE', message: 'This feedback is no longer waiting on you.' })

  await notifyReviewers('Feedback was updated by the employer and is ready for review.')
  await logActivity(req.company._id, 'Rejection feedback resubmitted for review', 'navy')
  res.json(toEmployerView(updated))
})

// GET /api/employer/rejection-feedback/options — the stage and reason lists the form renders.
export const feedbackOptions = (_req, res) => {
  res.json({
    stages: Object.entries(FEEDBACK_STAGES).map(([code, label]) => ({ code, label })),
    reasons: Object.entries(FEEDBACK_REASONS).map(([code, r]) => ({ code, label: r.label, category: r.category })),
  })
}
