import RejectionFeedback from '../models/RejectionFeedback.js'
import StaffUser from '../models/StaffUser.js'
import Employee from '../models/Employee.js'
import Company from '../models/Company.js'
import Job from '../models/Job.js'
import { notifyEmployee } from './notifyEmployee.js'
import { notifyStaff } from './notifyStaff.js'
import { notifyEmployer } from './notifyEmployer.js'
import { logger } from '../config/logger.js'

// Moves a feedback record between statuses atomically: the update only applies if the
// record is still in one of `from` (and, when `rev` is given, still at the revision the
// reviewer was looking at), so two reviewers, a double click or a stale screen can't
// both act on the same state. Returns the updated doc, or null when the record wasn't in
// a permitted state (callers answer 409).
export function transition(id, from, set, audit, extra = {}, { rev } = {}) {
  const { $push: extraPush, $inc: extraInc, ...otherOps } = extra
  const filter = { _id: id, status: { $in: from } }
  if (Number.isInteger(rev)) filter.rev = rev
  return RejectionFeedback.findOneAndUpdate(
    filter,
    {
      $set: set,
      $push: { audit: { ...audit, fromStatus: audit.fromStatus ?? null, at: new Date() }, ...extraPush },
      $inc: { rev: 1, ...extraInc },
      ...otherOps,
    },
    { new: true }
  )
}

// Best-effort: a notification failing must never undo or fail the workflow step that
// triggered it. Returns whether it was sent, which callers record.
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

// Tells every seat at the employer that Mzobs needs something from them.
export function notifyCompany(companyId, { title, body }) {
  return safely('employer notification', () => notifyEmployer({ _id: companyId }, { category: 'candidates', title, body }))
}

export function recordAudit(id, entry) {
  return RejectionFeedback.updateOne({ _id: id }, { $push: { audit: { ...entry, at: new Date() } } })
}

export const actorOf = (staff) => ({ actorType: 'staff', actorId: String(staff._id), actorName: staff.name ?? '' })

// --- candidate notification (tracked separately from approval) -------------------------

const NOTIFICATION_COPY = {
  approved: { title: 'Feedback available', body: 'The employer’s feedback on your application is now available in My applications.' },
  revised: { title: 'Feedback updated', body: 'We reviewed your report and updated the feedback on your application.' },
}

// Sends the "feedback available" message for the current version exactly once. Safe to
// call again (retry button, double click): an attempt is claimed atomically and the
// notification itself carries an idempotency key, so a candidate never gets two.
export async function deliverCandidateNotification(feedbackId, { kind = 'approved', staff } = {}) {
  const claimed = await RejectionFeedback.findOneAndUpdate(
    { _id: feedbackId, 'notification.status': { $in: ['pending', 'failed'] } },
    { $inc: { 'notification.attempts': 1 }, $set: { 'notification.lastAttemptAt': new Date() } },
    { new: true }
  )
  if (!claimed) return { sent: false, skipped: true }

  const version = claimed.notification.version
  let status = 'sent'
  let error = ''
  try {
    const employee = await Employee.findById(claimed.employee)
    if (!employee) throw new Error('Candidate account no longer exists')
    const copy = NOTIFICATION_COPY[kind] ?? NOTIFICATION_COPY.approved
    const created = await notifyEmployee(employee, { category: 'applications', ...copy, dedupeKey: `rejection-feedback:${feedbackId}:v${version}` })
    // null = the candidate switched this category off; that is a valid outcome, not a failure.
    if (!created) status = 'suppressed'
  } catch (err) {
    status = 'failed'
    error = String(err?.message ?? err).slice(0, 300)
    logger.warn({ err }, 'Rejection feedback: candidate notification failed')
  }

  await RejectionFeedback.updateOne(
    { _id: feedbackId },
    {
      $set: { 'notification.status': status, 'notification.error': error, ...(status === 'sent' ? { 'notification.sentAt': new Date() } : {}) },
      $push: {
        audit: {
          action: status === 'failed' ? 'candidate_notification_failed' : status === 'suppressed' ? 'candidate_notification_suppressed' : 'candidate_notified',
          actorType: staff ? 'staff' : 'system',
          actorId: staff ? String(staff._id) : '',
          actorName: staff?.name ?? '',
          note: error ? `attempt ${claimed.notification.attempts}: ${error}` : `version ${version}`,
          at: new Date(),
        },
      },
    }
  )
  return { sent: status === 'sent', status, error }
}

// --- records -----------------------------------------------------------------------------

async function snapshotsFor(candidate) {
  const [company, job] = await Promise.all([Company.findById(candidate.company).select('name'), candidate.job ? Job.findById(candidate.job).select('title') : null])
  return { candidateName: candidate.name ?? '', companyName: company?.name ?? '', jobTitle: job?.title ?? candidate.appliedFor ?? '' }
}

// Called when an employer rejects a candidate with structured feedback — or supplies it
// late for a candidate who was already rejected without any.
//  - no record yet            -> created, queued for review
//  - pending/returned         -> content replaced (the old submission is kept in history), back to pending
//  - approved/disputed/flagged -> left exactly as it is (a re-rejection never silently rewrites
//                                feedback a candidate may have read)
export async function recordRejectionFeedback({ candidate, userId, value }) {
  const existing = await RejectionFeedback.findOne({ candidate: candidate._id }).select('+submissions')

  if (existing) {
    if (['approved', 'disputed', 'flagged'].includes(existing.status)) return { feedback: existing, result: 'kept' }
    const revision = existing.submissions.length + 1
    const updated = await transition(
      existing._id,
      ['pending_review', 'returned'],
      { stage: value.stage, reasons: value.reasons, outcome: value.outcome, employerRemarks: value.remarks, status: 'pending_review' },
      { action: 'employer_resubmitted', actorType: 'employer', actorId: String(userId), fromStatus: existing.status, toStatus: 'pending_review', note: `revision ${revision}` },
      { $push: { submissions: { revision, by: userId, stage: value.stage, reasons: value.reasons, remarks: value.remarks, at: new Date() } }, $unset: { clarification: '' } }
    )
    if (updated) await notifyReviewers('Feedback was updated by the employer and is ready for review.')
    return { feedback: updated ?? existing, result: updated ? 'resubmitted' : 'kept' }
  }

  try {
    const now = new Date()
    const created = await RejectionFeedback.create({
      company: candidate.company,
      job: candidate.job,
      candidate: candidate._id,
      application: candidate.application,
      employee: candidate.employee,
      submittedBy: userId,
      ...(await snapshotsFor(candidate)),
      rejectedAt: candidate.stage === 'rejected' ? (candidate.updatedAt ?? now) : now,
      stage: value.stage,
      reasons: value.reasons,
      outcome: value.outcome,
      employerRemarks: value.remarks,
      submissions: [{ revision: 1, by: userId, stage: value.stage, reasons: value.reasons, remarks: value.remarks, at: now }],
      status: 'pending_review',
      audit: [{ action: 'employer_submitted', actorType: 'employer', actorId: String(userId), fromStatus: null, toStatus: 'pending_review', at: now }],
    })
    await notifyReviewers('New rejection feedback is waiting for review.')
    return { feedback: created, result: 'created' }
  } catch (err) {
    // Two concurrent rejections raced on the unique candidate index — the other one won.
    if (err?.code === 11000) return { feedback: await RejectionFeedback.findOne({ candidate: candidate._id }), result: 'kept' }
    throw err
  }
}

// Fills the denormalised search fields on records created before they existed.
export async function backfillSnapshots(limit = 200) {
  const rows = await RejectionFeedback.find({ $or: [{ candidateName: '' }, { candidateName: { $exists: false } }] }).limit(limit).populate([
    { path: 'candidate', select: 'name appliedFor updatedAt' },
    { path: 'company', select: 'name' },
    { path: 'job', select: 'title' },
  ])
  await Promise.all(
    rows.map((row) =>
      RejectionFeedback.updateOne(
        { _id: row._id },
        { $set: { candidateName: row.candidate?.name ?? '', companyName: row.company?.name ?? '', jobTitle: row.job?.title ?? row.candidate?.appliedFor ?? '', rejectedAt: row.createdAt } }
      )
    )
  )
  return rows.length
}
