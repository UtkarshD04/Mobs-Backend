import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import Job from '../models/Job.js'
import Interview from '../models/Interview.js'
import Offer from '../models/Offer.js'
import Candidate from '../models/Candidate.js'
import Activity from '../models/Activity.js'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const sum = (rows, field) => rows.reduce((total, r) => total + (r[field] ?? 0), 0)
const weekDelta = (count) => (count > 0 ? `+${count} this week` : 'No change this week')

export const getDashboard = asyncHandler(async (req, res) => {
  const companyId = req.company._id
  const since = new Date(Date.now() - WEEK_MS)

  const [jobs, interviews, offers, candidates, activityRows] = await Promise.all([
    Job.find({ company: companyId }),
    Interview.find({ company: companyId }),
    Offer.find({ company: companyId }),
    Candidate.find({ company: companyId }),
    Activity.find({ company: companyId }).sort({ createdAt: -1 }).limit(8),
  ])

  const activeJobs = jobs.filter((j) => !['draft', 'closed', 'archived'].includes(j.status))
  const paidJobs = jobs.filter((j) => j.feeStatus === 'paid')
  const activeInterviews = interviews.filter((i) => i.status !== 'Cancelled')
  const hiredCandidates = candidates.filter((c) => c.stage === 'hired')

  const shortlistedCandidates = candidates.filter((c) => ['shortlisted', 'interviewing', 'offered', 'hired'].includes(c.stage))

  const stats = {
    openRequirements: activeJobs.length,
    openRequirementsDelta: weekDelta(jobs.filter((j) => j.createdAt >= since).length),
    openingsPaid: sum(paidJobs, 'vacancies'),
    openingsPaidDelta: weekDelta(jobs.filter((j) => j.paidOn && j.paidOn >= since).length),
    resumesReceived: sum(jobs, 'candidatesShared'),
    resumesReceivedDelta: weekDelta(0),
    shortlisted: shortlistedCandidates.length,
    shortlistedDelta: weekDelta(shortlistedCandidates.filter((c) => c.updatedAt >= since).length),
    interviewsScheduled: activeInterviews.length,
    interviewsDelta: weekDelta(interviews.filter((i) => i.createdAt >= since).length),
    offersSent: offers.length,
    offersDelta: weekDelta(offers.filter((o) => o.createdAt >= since).length),
    employeesJoined: hiredCandidates.length,
    employeesJoinedDelta: weekDelta(hiredCandidates.filter((c) => c.updatedAt >= since).length),
  }

  const funnel = [
    { label: 'Openings Paid For', value: sum(paidJobs, 'vacancies') },
    { label: 'Resumes Owed by Mzobs', value: sum(paidJobs, 'resumesPromised') },
    { label: 'Resumes Delivered', value: sum(paidJobs, 'candidatesShared') },
    { label: 'Shortlisted by Us', value: candidates.filter((c) => ['shortlisted', 'interviewing', 'offered', 'hired'].includes(c.stage)).length },
    { label: 'Interviewed', value: candidates.filter((c) => ['interviewing', 'offered', 'hired'].includes(c.stage)).length },
    { label: 'Selected', value: hiredCandidates.length },
  ]

  const monthLabels = []
  const trendCounts = new Array(6).fill(0)
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    monthLabels.push(d.toLocaleDateString('en-IN', { month: 'short' }))
  }
  hiredCandidates.forEach((c) => {
    const monthsAgo =
      (now.getFullYear() - c.updatedAt.getFullYear()) * 12 + (now.getMonth() - c.updatedAt.getMonth())
    if (monthsAgo >= 0 && monthsAgo < 6) trendCounts[5 - monthsAgo] += 1
  })
  const trend = monthLabels.map((label, i) => ({ label, value: trendCounts[i] }))

  const departmentCounts = new Map()
  activeJobs.forEach((j) => departmentCounts.set(j.department, (departmentCounts.get(j.department) ?? 0) + 1))
  const departments = [...departmentCounts.entries()].map(([label, value]) => ({ label, value }))

  const activity = activityRows.map((a) => ({ text: a.text, time: formatRelative(a.createdAt), tone: a.tone }))

  const upcomingInterviews = await Interview.find({
    company: companyId,
    status: { $in: ['Confirmed', 'Awaiting confirmation'] },
  })
    .sort({ startsAt: 1 })
    .limit(4)

  // Per-requirement funnel counts for the dashboard's requirements table —
  // derived from the candidates/interviews already loaded above, so no
  // extra queries. Candidate.job -> Interview is joined via candidate.id
  // since Interview only references the candidate, not the job directly.
  const candidatesByJob = new Map()
  candidates.forEach((c) => {
    const jobId = String(c.job)
    if (!candidatesByJob.has(jobId)) candidatesByJob.set(jobId, [])
    candidatesByJob.get(jobId).push(c)
  })
  const jobIdByCandidateId = new Map(candidates.map((c) => [String(c._id), String(c.job)]))
  const interviewCountByJob = new Map()
  interviews
    .filter((i) => i.status !== 'Cancelled')
    .forEach((i) => {
      const jobId = jobIdByCandidateId.get(String(i.candidate))
      if (!jobId) return
      interviewCountByJob.set(jobId, (interviewCountByJob.get(jobId) ?? 0) + 1)
    })

  const activeRequirements = activeJobs
    .slice()
    .sort((a, b) => b.updatedOn - a.updatedOn)
    .slice(0, 8)
    .map((j) => {
      const jobCandidates = candidatesByJob.get(String(j._id)) ?? []
      return {
        id: j._id,
        title: j.title,
        location: j.location,
        applicants: jobCandidates.length,
        shortlisted: jobCandidates.filter((c) => ['shortlisted', 'interviewing', 'offered', 'hired'].includes(c.stage)).length,
        interviews: interviewCountByJob.get(String(j._id)) ?? 0,
        status: j.status,
        createdOn: j.postedOn ?? j.createdAt,
      }
    })

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const todaySchedule = interviews
    .filter((i) => i.status !== 'Cancelled' && i.startsAt >= todayStart && i.startsAt < todayEnd)
    .sort((a, b) => a.startsAt - b.startsAt)
    .map((i) => ({ id: i._id, candidateName: i.candidateName, role: i.role, startsAt: i.startsAt, mode: i.mode, status: i.status }))

  // Multi-series performance trend for the dashboard's analytics chart, bucketed
  // by day (7d/30d) or by week (90d). Derived entirely from documents already
  // loaded above — "shortlisted"/"hired" use updatedAt as a proxy for "reached
  // that stage on this date" since stage-transition history isn't tracked
  // separately; everything else uses its own createdAt/sharedOn.
  function buildPerformanceSeries(days, bucketDays) {
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
    const bucketMs = bucketDays * 24 * 60 * 60 * 1000
    const numBuckets = Math.ceil(days / bucketDays)
    const series = []
    for (let i = 0; i < numBuckets; i++) {
      const bucketStart = new Date(start.getTime() + i * bucketMs)
      const bucketEnd = new Date(Math.min(bucketStart.getTime() + bucketMs, now.getTime() + 1))
      const inBucket = (d) => d && d >= bucketStart && d < bucketEnd
      series.push({
        label: bucketStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        applications: candidates.filter((c) => inBucket(c.sharedOn)).length,
        shortlisted: candidates.filter((c) => ['shortlisted', 'interviewing', 'offered', 'hired'].includes(c.stage) && inBucket(c.updatedAt)).length,
        interviews: interviews.filter((iv) => inBucket(iv.createdAt)).length,
        offers: offers.filter((o) => inBucket(o.createdAt)).length,
        hired: candidates.filter((c) => c.stage === 'hired' && inBucket(c.updatedAt)).length,
      })
    }
    return series
  }

  const performance = {
    '7d': buildPerformanceSeries(7, 1),
    '30d': buildPerformanceSeries(30, 1),
    '90d': buildPerformanceSeries(90, 7),
  }

  // Candidate-stage pipeline (distinct from `funnel` above, which tracks Mzobs's
  // sourcing fulfilment) — cumulative counts per Candidate.stage, each paired
  // with the `stage` query param Candidates.jsx expects so dashboard cards
  // can deep-link straight into the matching filtered list.
  const pipeline = [
    { key: 'applicants', label: 'Applicants', value: candidates.length, stageParam: 'all' },
    { key: 'shortlisted', label: 'Shortlisted', value: shortlistedCandidates.length, stageParam: 'shortlisted' },
    { key: 'interviewing', label: 'Interview', value: candidates.filter((c) => ['interviewing', 'offered', 'hired'].includes(c.stage)).length, stageParam: 'interviewing' },
    { key: 'offered', label: 'Offer', value: candidates.filter((c) => ['offered', 'hired'].includes(c.stage)).length, stageParam: 'offered' },
    { key: 'hired', label: 'Hired', value: hiredCandidates.length, stageParam: 'hired' },
  ]

  res.json({ stats, funnel, pipeline, trend, performance, departments, activity, upcomingInterviews, activeRequirements, todaySchedule })
})
