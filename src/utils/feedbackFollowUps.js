import Candidate from '../models/Candidate.js'
import Company from '../models/Company.js'
import Job from '../models/Job.js'
import User from '../models/User.js'
import RejectionFeedback from '../models/RejectionFeedback.js'
import FeedbackFollowUp from '../models/FeedbackFollowUp.js'

// Follow-up cases are derived from real records only:
//  - missing_feedback      a candidate was rejected on the platform and the employer never supplied feedback
//  - returned_unanswered   a reviewer sent feedback back (or flagged it) and the employer hasn't answered
//  - clarification_pending the same, after a candidate's report was returned to the employer
// A case is opened once per candidate and kind, and closed automatically as soon as the
// condition that opened it no longer holds.

export const MISSING_AFTER_HOURS = 24
export const UNANSWERED_AFTER_DAYS = 3
export const MISSING_WINDOW_DAYS = 14
export const NOTIFY_COOLDOWN_HOURS = 24
const SYNC_LIMIT = 200
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

export const OUTSTANDING = {
  missing_feedback: 'Submit the reason for rejecting this candidate',
  returned_unanswered: 'Update the feedback Mzobs sent back',
  clarification_pending: 'Answer the clarification Mzobs asked for',
}

// Does the condition that opened this case still hold? Used to verify "mark complete".
export async function stillOutstanding(followUp) {
  if (followUp.type === 'missing_feedback') {
    const hasFeedback = await RejectionFeedback.exists({ candidate: followUp.candidate })
    const candidate = await Candidate.findById(followUp.candidate).select('stage')
    return !hasFeedback && candidate?.stage === 'rejected'
  }
  const feedback = await RejectionFeedback.findOne({ candidate: followUp.candidate }).select('status')
  return feedback?.status === 'returned'
}

async function contactFor(companyId, userId) {
  const user = (userId && (await User.findById(userId).select('name email'))) || (await User.findOne({ company: companyId, role: 'Admin', status: { $ne: 'disabled' } }).select('name email')) || (await User.findOne({ company: companyId, status: { $ne: 'disabled' } }).select('name email'))
  return { contactName: user?.name ?? '', contactEmail: user?.email ?? '' }
}

async function open({ candidate, type, userId, ...rest }) {
  try {
    await FeedbackFollowUp.updateOne(
      { candidate, type, status: 'open' },
      { $setOnInsert: { ...rest, ...(await contactFor(rest.company, userId)), outstandingAction: OUTSTANDING[type] } },
      { upsert: true }
    )
  } catch (err) {
    // A concurrent sync opened the same case first.
    if (err?.code !== 11000) throw err
  }
}

// Opens cases for newly overdue records and closes cases whose condition has cleared.
// Idempotent and bounded, so it is safe to run on every queue load.
export async function syncFollowUps(now = new Date()) {
  const missingBefore = new Date(now - MISSING_AFTER_HOURS * HOUR)
  const windowStart = new Date(now - MISSING_WINDOW_DAYS * DAY)

  // 1. Rejected platform candidates with no feedback record at all.
  const rejected = await Candidate.find({ stage: 'rejected', employee: { $ne: null }, application: { $ne: null }, updatedAt: { $lte: missingBefore, $gte: windowStart } })
    .sort({ updatedAt: -1 })
    .limit(SYNC_LIMIT)
    .select('company job application name appliedFor updatedAt')
  if (rejected.length) {
    const have = new Set((await RejectionFeedback.find({ candidate: { $in: rejected.map((c) => c._id) } }).select('candidate')).map((f) => String(f.candidate)))
    const [companies, jobs] = await Promise.all([
      Company.find({ _id: { $in: [...new Set(rejected.map((c) => String(c.company)))] } }).select('name'),
      Job.find({ _id: { $in: rejected.map((c) => c.job).filter(Boolean) } }).select('title'),
    ])
    const companyName = new Map(companies.map((c) => [String(c._id), c.name]))
    const jobTitle = new Map(jobs.map((j) => [String(j._id), j.title]))
    for (const c of rejected.filter((c) => !have.has(String(c._id)))) {
      await open({
        type: 'missing_feedback', company: c.company, candidate: c._id, application: c.application, job: c.job,
        candidateName: c.name, companyName: companyName.get(String(c.company)) ?? '', jobTitle: jobTitle.get(String(c.job)) ?? c.appliedFor ?? '', dueSince: c.updatedAt,
      })
    }
  }

  // 2. Feedback a reviewer sent back that the employer hasn't answered.
  const stale = await RejectionFeedback.find({ status: 'returned', 'clarification.message': { $exists: true }, 'clarification.requestedAt': { $lte: new Date(now - UNANSWERED_AFTER_DAYS * DAY) } })
    .limit(SYNC_LIMIT)
    .select('company job candidate application candidateName companyName jobTitle submittedBy clarification')
  for (const f of stale) {
    await open({
      type: f.clarification.kind === 'dispute' ? 'clarification_pending' : 'returned_unanswered',
      company: f.company, candidate: f.candidate, application: f.application, job: f.job, feedback: f._id,
      candidateName: f.candidateName, companyName: f.companyName, jobTitle: f.jobTitle, dueSince: f.clarification.requestedAt, userId: f.submittedBy,
    })
  }

  // 3. Close what has been resolved.
  const openCases = await FeedbackFollowUp.find({ status: 'open' }).limit(500)
  let closed = 0
  for (const c of openCases) {
    if (!(await stillOutstanding(c))) {
      await FeedbackFollowUp.updateOne({ _id: c._id, status: 'open' }, { $set: { status: 'completed', completedAt: now, completedBy: 'system', autoCompleted: true } })
      closed++
    }
  }
  return { closed }
}

export const canNotifyAgain = (followUp, now = new Date()) =>
  !followUp.lastNotifiedAt || now - followUp.lastNotifiedAt >= NOTIFY_COOLDOWN_HOURS * HOUR
