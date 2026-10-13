import RejectionFeedback from '../models/RejectionFeedback.js'
import StaffUser from '../models/StaffUser.js'
import Employee from '../models/Employee.js'
import { notifyEmployee } from './notifyEmployee.js'
import { notifyStaff } from './notifyStaff.js'
import { logger } from '../config/logger.js'

// Moves a feedback record between statuses atomically: the update only applies
// if the record is still in one of `from`, so two reviewers (or a double click)
// can't both act on the same state. Returns the updated doc, or null when the
// record wasn't in a permitted state (caller answers 409).
export function transition(id, from, set, audit, extra = {}) {
  const { $push: extraPush, ...otherOps } = extra
  return RejectionFeedback.findOneAndUpdate(
    { _id: id, status: { $in: from } },
    { $set: set, $push: { audit: { ...audit, fromStatus: audit.fromStatus ?? null, at: new Date() }, ...extraPush }, ...otherOps },
    { new: true }
  )
}

// Best-effort: a notification failing must never undo or fail the workflow
// step that triggered it. Returns whether it was sent, which callers record.
async function safely(label, fn) {
  try {
    await fn()
    return true
  } catch (err) {
    logger.warn({ err }, `Rejection feedback: ${label} failed`)
    return false
  }
}

export function notifyReviewers(text) {
  return safely('reviewer notification', async () => {
    const admins = await StaffUser.find({ accessLevel: 'admin', status: { $ne: 'disabled' } }).select('_id')
    await Promise.all(admins.map((staff) => notifyStaff(staff, { category: 'system', title: 'Rejection feedback to review', body: text })))
  })
}

export function notifyCandidate(employeeId, { title, body }) {
  return safely('candidate notification', async () => {
    const employee = await Employee.findById(employeeId)
    if (employee) await notifyEmployee(employee, { category: 'applications', title, body })
  })
}

export function recordAudit(id, entry) {
  return RejectionFeedback.updateOne({ _id: id }, { $push: { audit: { ...entry, at: new Date() } } })
}

// Called when an employer rejects a candidate with structured feedback.
//  - no record yet            -> created, queued for review
//  - pending/returned/flagged -> content replaced, back to pending review
//  - approved/disputed        -> left exactly as delivered (a re-rejection never
//                                silently rewrites feedback a candidate may have read)
export async function recordRejectionFeedback({ candidate, userId, value }) {
  const existing = await RejectionFeedback.findOne({ candidate: candidate._id })

  if (existing) {
    if (existing.status === 'approved' || existing.status === 'disputed') return { feedback: existing, result: 'kept' }
    const updated = await transition(
      existing._id,
      ['pending_review', 'returned', 'flagged'],
      { stage: value.stage, reasons: value.reasons, outcome: value.outcome, employerRemarks: value.remarks, status: 'pending_review' },
      { action: 'employer_resubmitted', actorType: 'employer', actorId: String(userId), fromStatus: existing.status, toStatus: 'pending_review' },
      { $unset: { clarification: '' } }
    )
    if (updated) await notifyReviewers('Feedback was updated by the employer and is ready for review.')
    return { feedback: updated ?? existing, result: updated ? 'resubmitted' : 'kept' }
  }

  try {
    const created = await RejectionFeedback.create({
      company: candidate.company,
      job: candidate.job,
      candidate: candidate._id,
      application: candidate.application,
      employee: candidate.employee,
      submittedBy: userId,
      stage: value.stage,
      reasons: value.reasons,
      outcome: value.outcome,
      employerRemarks: value.remarks,
      status: 'pending_review',
      audit: [{ action: 'employer_submitted', actorType: 'employer', actorId: String(userId), fromStatus: null, toStatus: 'pending_review', at: new Date() }],
    })
    await notifyReviewers('New rejection feedback is waiting for review.')
    return { feedback: created, result: 'created' }
  } catch (err) {
    // Two concurrent rejections raced on the unique candidate index — the other one won.
    if (err?.code === 11000) return { feedback: await RejectionFeedback.findOne({ candidate: candidate._id }), result: 'kept' }
    throw err
  }
}
