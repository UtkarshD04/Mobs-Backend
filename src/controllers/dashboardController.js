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

  const stats = {
    openRequirements: activeJobs.length,
    openRequirementsDelta: weekDelta(jobs.filter((j) => j.createdAt >= since).length),
    openingsPaid: sum(paidJobs, 'vacancies'),
    openingsPaidDelta: weekDelta(jobs.filter((j) => j.paidOn && j.paidOn >= since).length),
    resumesReceived: sum(jobs, 'candidatesShared'),
    resumesReceivedDelta: weekDelta(0),
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

  res.json({ stats, funnel, trend, departments, activity, upcomingInterviews })
})
