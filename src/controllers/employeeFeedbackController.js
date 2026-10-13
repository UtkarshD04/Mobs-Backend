import { asyncHandler } from '../utils/asyncHandler.js'
import Application from '../models/Application.js'
import RejectionFeedback from '../models/RejectionFeedback.js'
import { candidateFeedbackStatus, latestApprovedVersion, toCandidateView, validateMessage, DISPUTE_MAX, DISPUTE_MIN } from '../utils/rejectionFeedback.js'
import { notifyReviewers, transition } from '../utils/rejectionFeedbackService.js'

// Every lookup is keyed on BOTH the application id and req.employee — a candidate
// can only ever reach feedback on their own application, and the response is the
// allow-listed toCandidateView(), so nothing from the employer or reviewer side leaks.

async function ownApplication(req) {
  return Application.findOne({ _id: req.params.id, employee: req.employee._id }).select('status')
}

// GET /api/employee/applications/:id/feedback
export const getFeedback = asyncHandler(async (req, res) => {
  const application = await ownApplication(req)
  if (!application) return res.status(404).json({ message: 'Application not found' })

  // The query selects only what the projection needs; employerRemarks, audit and the
  // dispute's free text are select:false on the model and are never loaded here.
  const feedback = await RejectionFeedback.findOne({ application: application._id }).select('stage versions status dispute.status dispute.raisedAt')
  const status = candidateFeedbackStatus(application.status, feedback)
  if (status !== 'available') return res.json({ status })

  res.json({ status, feedback: toCandidateView(feedback) })
})

// POST /api/employee/applications/:id/feedback/dispute  { reason }
export const disputeFeedback = asyncHandler(async (req, res) => {
  const application = await ownApplication(req)
  if (!application) return res.status(404).json({ message: 'Application not found' })

  const { value: reason, error } = validateMessage(req.body?.reason, { min: DISPUTE_MIN, max: DISPUTE_MAX, label: 'description of the problem' })
  if (error) return res.status(400).json({ message: error })

  const feedback = await RejectionFeedback.findOne({ application: application._id }).select('versions status dispute.status dispute.version')
  const delivered = latestApprovedVersion(feedback)
  if (!feedback || !delivered) return res.status(404).json({ message: 'There is no feedback to report on this application' })
  if (feedback.dispute?.status === 'open') return res.status(409).json({ code: 'DISPUTE_ALREADY_OPEN', message: 'You have already reported this feedback. We are reviewing it.' })
  if (feedback.dispute?.status === 'resolved' && feedback.dispute.version === delivered.number) {
    return res.status(409).json({ code: 'DISPUTE_ALREADY_REVIEWED', message: 'We have already reviewed a report about this feedback.' })
  }

  const updated = await transition(
    feedback._id,
    ['approved'],
    { status: 'disputed', dispute: { status: 'open', reason, raisedAt: new Date(), version: delivered.number } },
    { action: 'candidate_disputed', actorType: 'candidate', actorId: String(req.employee._id), fromStatus: 'approved', toStatus: 'disputed' }
  )
  if (!updated) return res.status(409).json({ code: 'FEEDBACK_STATE_CHANGED', message: 'This feedback can’t be reported right now.' })

  await notifyReviewers('A candidate reported a problem with delivered rejection feedback.')
  res.status(201).json({ status: 'under_review' })
})

// Used by the applications list: one query for the whole page, status label only.
export async function feedbackStatusByApplication(applications) {
  const rejected = applications.filter((a) => a.status === 'rejected')
  if (rejected.length === 0) return new Map()
  const rows = await RejectionFeedback.find({ application: { $in: rejected.map((a) => a._id) } }).select('application versions.number')
  const byApplication = new Map(rows.map((row) => [String(row.application), row]))
  return new Map(rejected.map((a) => [String(a._id), candidateFeedbackStatus(a.status, byApplication.get(String(a._id)))]))
}
