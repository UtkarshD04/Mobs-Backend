import { asyncHandler } from '../utils/asyncHandler.js'
import { can } from '../utils/permissions.js'
import { feedbackState } from './interviewController.js'
import { getWalletBalance } from '../utils/creditWallet.js'
import Job from '../models/Job.js'
import Candidate from '../models/Candidate.js'
import Interview from '../models/Interview.js'
import Offer from '../models/Offer.js'
import Activity from '../models/Activity.js'
import CandidateEvent from '../models/CandidateEvent.js'
import RejectionFeedback from '../models/RejectionFeedback.js'
import ManagedShortlistRequest from '../models/ManagedShortlistRequest.js'

const DAY = 86400000
const LIVE = ['sourcing', 'delivered']
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// "Apply by" is free text on Job; only a date that actually parses counts as a deadline.
function deadlineOf(job) {
  if (!job.deadline) return null
  const d = new Date(job.deadline)
  return Number.isNaN(d.getTime()) ? null : d
}

// Everything on the Overview is derived from stored records — no estimates, nothing invented.
export const getOverview = asyncHandler(async (req, res) => {
  const companyId = req.company._id
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endToday = new Date(startToday.getTime() + DAY)
  const endWeek = new Date(startToday.getTime() + 7 * DAY)
  const role = req.user.role
  const seesAll = can(role, 'candidates.view')

  const interviewQuery = { company: companyId, status: { $ne: 'Cancelled' }, startsAt: { $gte: new Date(now.getTime() - 60 * DAY) } }
  if (!seesAll) interviewQuery['interviewers.user'] = req.user._id

  // Interviewers (and anyone who cannot see applicants) get their own interviews only.
  if (!seesAll) {
    const interviews = can(role, 'candidates.viewAssigned') ? await Interview.find(interviewQuery).sort({ startsAt: 1 }) : []
    const pending = interviews.filter((i) => feedbackState(i, now).pending)
    const credits = can(role, 'billing.view') ? (await getWalletBalance(companyId)).remainingCredits : null
    return res.json({
      scope: 'limited',
      stats: { interviewsToday: interviews.filter((i) => i.startsAt >= startToday && i.startsAt < endToday).length, interviewsWeek: interviews.filter((i) => i.startsAt >= startToday && i.startsAt < endWeek).length, feedbackPending: pending.length, creditsRemaining: credits },
      attention: pending.length ? [{ id: 'feedback', kind: 'feedback', severity: pending.some((i) => feedbackState(i, now).overdue) ? 'high' : 'medium', text: `Submit feedback for ${plural(pending.length, 'interview')}`, href: '/interviews?filter=feedback', count: pending.length }] : [],
      activity: [],
      jobHealth: [],
    })
  }

  const [jobs, candidates, interviews, offers, wallet, returnedFeedback, sharedShortlists] = await Promise.all([
    Job.find({ company: companyId, status: { $nin: ['draft', 'archived'] } }).select('title status postedOn createdAt deadline vacancies'),
    Candidate.find({ company: companyId, stage: { $nin: ['hired', 'rejected'] } }).select('job stage reviewedAt sharedOn followUpOn name'),
    Interview.find(interviewQuery).sort({ startsAt: 1 }),
    Offer.find({ company: companyId, status: { $in: ['pending', 'draft'] } }).sort({ expiresOn: 1 }),
    can(role, 'billing.view') ? getWalletBalance(companyId) : null,
    RejectionFeedback.countDocuments({ company: companyId, status: 'returned' }),
    ManagedShortlistRequest.find({ company: companyId, status: 'shortlist_shared' }).populate('job', 'title'),
  ])

  const activeJobs = jobs.filter((j) => !['closed'].includes(j.status))
  const liveJobs = jobs.filter((j) => LIVE.includes(j.status))
  const titleById = new Map(jobs.map((j) => [String(j._id), j.title]))
  const isNew = (c) => c.stage === 'shared' && !c.reviewedAt
  const newCandidates = candidates.filter(isNew)

  const feedbackPending = interviews.filter((i) => feedbackState(i, now).pending)
  const feedbackOverdue = feedbackPending.filter((i) => feedbackState(i, now).overdue)
  const offersExpiringSoon = offers.filter((o) => o.expiresOn && o.expiresOn.getTime() - now.getTime() < 3 * DAY)
  const followUpsDue = candidates.filter((c) => c.followUpOn && c.followUpOn <= now)

  // Needs your attention — each row links straight to where the work is done.
  const attention = []
  const newByJob = new Map()
  for (const c of newCandidates) if (c.job) newByJob.set(String(c.job), (newByJob.get(String(c.job)) ?? 0) + 1)
  ;[...newByJob.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .forEach(([jobId, n]) => attention.push({ id: `new-${jobId}`, kind: 'applicants', severity: 'medium', text: `Review ${plural(n, 'new applicant')} for ${titleById.get(jobId) ?? 'a job'}`, href: `/jobs/${jobId}/applicants?stage=new`, count: n }))
  if (feedbackPending.length) attention.push({ id: 'feedback', kind: 'feedback', severity: feedbackOverdue.length ? 'high' : 'medium', text: `${plural(feedbackPending.length, 'interview')} waiting for feedback${feedbackOverdue.length ? ` (${feedbackOverdue.length} past the deadline)` : ''}`, href: '/interviews?filter=feedback', count: feedbackPending.length })
  if (offers.length) attention.push({ id: 'offers', kind: 'offers', severity: offersExpiringSoon.length ? 'high' : 'low', text: `${plural(offers.length, 'offer')} awaiting a response${offersExpiringSoon.length ? `, ${offersExpiringSoon.length} expiring within 3 days` : ''}`, href: '/offers', count: offers.length })
  if (followUpsDue.length) attention.push({ id: 'followups', kind: 'followups', severity: 'medium', text: `${plural(followUpsDue.length, 'candidate follow-up')} due`, href: '/applicants?followUp=due', count: followUpsDue.length })
  for (const r of sharedShortlists) attention.push({ id: `ms-${r.id}`, kind: 'managed', severity: 'medium', text: `MZOBS shared a shortlist for ${r.job?.title ?? 'a job'}`, href: `/jobs/${r.job?._id}/applicants`, count: r.sharedCandidates.length })
  if (returnedFeedback) attention.push({ id: 'rejfb', kind: 'feedback-followup', severity: 'medium', text: `MZOBS needs a clarification on ${plural(returnedFeedback, 'rejection')}`, href: '/feedback', count: returnedFeedback })
  const order = { high: 0, medium: 1, low: 2 }
  attention.sort((a, b) => order[a.severity] - order[b.severity])

  // Job health — only conditions that are literally true of the stored data.
  const health = []
  const allByJob = await Candidate.aggregate([{ $match: { company: companyId, job: { $in: liveJobs.map((j) => j._id) } } }, { $group: { _id: '$job', total: { $sum: 1 }, advanced: { $sum: { $cond: [{ $in: ['$stage', ['shortlisted', 'interviewing', 'offered', 'hired']] }, 1, 0] } }, oldest: { $min: '$sharedOn' } } }])
  const totals = new Map(allByJob.map((r) => [String(r._id), r]))
  const feedbackJobs = new Set()
  if (feedbackPending.length) {
    const cands = await Candidate.find({ _id: { $in: feedbackPending.map((i) => i.candidate) } }).select('job')
    cands.forEach((c) => c.job && feedbackJobs.add(String(c.job)))
  }
  for (const j of liveJobs) {
    const id = String(j._id)
    const t = totals.get(id) ?? { total: 0, advanced: 0, oldest: null }
    const posted = j.postedOn ?? j.createdAt
    const ageDays = posted ? Math.floor((now - posted) / DAY) : 0
    if (ageDays >= 7 && t.total < 3) health.push({ jobId: id, jobTitle: j.title, type: 'low_applications', severity: 'medium', message: `${plural(t.total, 'applicant')} after ${plural(ageDays, 'day')} live` })
    const dl = deadlineOf(j)
    if (dl) {
      const left = Math.ceil((dl - now) / DAY)
      if (left < 0) health.push({ jobId: id, jobTitle: j.title, type: 'deadline_passed', severity: 'high', message: `Apply-by date passed ${plural(-left, 'day')} ago but the job is still live` })
      else if (left <= 3) health.push({ jobId: id, jobTitle: j.title, type: 'expiring', severity: 'medium', message: left === 0 ? 'Closes today' : `Closes in ${plural(left, 'day')}` })
    }
    if (t.total >= 5 && t.advanced === 0 && t.oldest && now - t.oldest >= 3 * DAY) health.push({ jobId: id, jobTitle: j.title, type: 'no_shortlist', severity: 'medium', message: `${t.total} applicants, none shortlisted yet` })
    if (feedbackJobs.has(id)) health.push({ jobId: id, jobTitle: j.title, type: 'feedback_pending', severity: 'medium', message: 'Interview feedback is pending' })
  }
  health.sort((a, b) => order[a.severity] - order[b.severity])

  // Recent activity: the company feed plus candidate-level events, newest first.
  const [feed, events] = await Promise.all([
    Activity.find({ company: companyId }).sort({ createdAt: -1 }).limit(10),
    CandidateEvent.find({ company: companyId, type: { $in: ['stage', 'interview', 'reject', 'offer', 'comm'] } }).sort({ createdAt: -1 }).limit(15).populate('candidate', 'name'),
  ])
  const activity = [
    ...feed.map((a) => ({ id: `a-${a.id}`, text: a.text, at: a.createdAt, actor: '' })),
    ...events.map((e) => ({ id: `e-${e.id}`, text: `${e.candidate?.name ?? 'Candidate'}: ${e.text}`, at: e.createdAt, actor: e.actorName })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 12)

  res.json({
    scope: 'full',
    stats: {
      activeJobs: activeJobs.length,
      newApplicants: newCandidates.length,
      interviewsToday: interviews.filter((i) => i.startsAt >= startToday && i.startsAt < endToday).length,
      interviewsWeek: interviews.filter((i) => i.startsAt >= startToday && i.startsAt < endWeek).length,
      feedbackPending: feedbackPending.length,
      offersAwaiting: offers.length,
      creditsRemaining: wallet ? wallet.remainingCredits : null,
    },
    attention,
    jobHealth: health,
    activity,
    upcoming: interviews.filter((i) => i.startsAt >= now && i.startsAt < endWeek).slice(0, 6).map((i) => ({ id: i.id, candidateName: i.candidateName, role: i.role, startsAt: i.startsAt, mode: i.mode })),
  })
})
