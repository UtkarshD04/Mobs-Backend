import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import Employee from '../models/Employee.js'
import Company from '../models/Company.js'
import Job from '../models/Job.js'
import Application from '../models/Application.js'
import MockInterview from '../models/MockInterview.js'
import Invoice from '../models/Invoice.js'
import StaffActivity from '../models/StaffActivity.js'
import StaffUser from '../models/StaffUser.js'
import User from '../models/User.js'

const RESUME_STATUSES = ['pending', 'verified', 'changes', 'rejected']

// Workers only see their own assigned resumes and scheduled mocks — the
// platform-wide KPIs/revenue below stay admin-only on the backend.
async function getPersonalDashboard(req, res) {
  const staffId = req.staff._id

  const [assignedEmployees, myMockInterviews] = await Promise.all([
    Employee.find({ 'resume.assignedTo': staffId }).select('resume'),
    MockInterview.find({ scheduledBy: staffId }).populate('employee', 'name').sort({ when: 1 }),
  ])

  const resumeStatusCounts = RESUME_STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), {})
  assignedEmployees.forEach((e) => {
    const status = e.resume?.status
    if (status in resumeStatusCounts) resumeStatusCounts[status] += 1
  })

  const kpis = {
    resumeQueue: resumeStatusCounts.pending,
    mockQueue: myMockInterviews.filter((m) => m.status === 'scheduled').length,
  }

  const resumeStatus = [
    { label: 'Pending', value: resumeStatusCounts.pending },
    { label: 'Verified', value: resumeStatusCounts.verified },
    { label: 'Changes requested', value: resumeStatusCounts.changes },
    { label: 'Rejected', value: resumeStatusCounts.rejected },
  ]

  const upcomingMockInterviews = myMockInterviews.filter((m) => m.status === 'scheduled').slice(0, 4)

  res.json({ kpis, resumeStatus, upcomingMockInterviews })
}

export const getDashboard = asyncHandler(async (req, res) => {
  if (req.staff.accessLevel !== 'admin') return getPersonalDashboard(req, res)

  // Counts and sums are done in MongoDB — loading whole collections into memory per
  // dashboard view does not survive growth (and runs on every admin refresh).
  const countBy = (Model, field, match = {}) => Model.aggregate([{ $match: match }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }])
  const toMap = (rows) => new Map(rows.map((r) => [r._id, r.count]))

  const [
    employeeCount,
    resumeRows,
    subscribedRows,
    trackRows,
    companyCount,
    pendingCompanies,
    openingsRows,
    applicationRows,
    mockRows,
    invoiceRows,
    activityRows,
    staffCount,
    employerCount,
  ] = await Promise.all([
    Employee.countDocuments({}),
    countBy(Employee, 'resume.status'),
    Employee.aggregate([{ $match: { 'subscription.status': 'paid' } }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: { $ifNull: ['$subscription.amount', 0] } } } }]),
    countBy(Employee, 'skillTrack.key', { 'skillTrack.key': { $nin: [null, ''] } }),
    Company.countDocuments({}),
    Company.countDocuments({ verificationStatus: 'pending' }),
    Job.aggregate([{ $match: { status: { $nin: ['draft', 'closed', 'archived'] } } }, { $group: { _id: null, total: { $sum: { $ifNull: ['$vacancies', 0] } } } }]),
    countBy(Application, 'status'),
    countBy(MockInterview, 'status'),
    Invoice.aggregate([{ $group: { _id: '$status', amount: { $sum: { $ifNull: ['$amount', 0] } } } }]),
    StaffActivity.find({}).sort({ createdAt: -1 }).limit(8),
    StaffUser.countDocuments({}),
    User.countDocuments({}),
  ])

  const resumeCounts = toMap(resumeRows)
  const applicationCounts = toMap(applicationRows)
  const mockCounts = toMap(mockRows)
  const invoiceAmount = new Map(invoiceRows.map((r) => [r._id, r.amount]))
  const subscribed = subscribedRows[0]?.count ?? 0
  const applicationsTotal = [...applicationCounts.values()].reduce((a, b) => a + b, 0)
  const appsWithStatus = (...statuses) => statuses.reduce((total, st) => total + (applicationCounts.get(st) ?? 0), 0)

  const kpis = {
    candidates: employeeCount,
    resumeQueue: resumeCounts.get('pending') ?? 0,
    mockQueue: mockCounts.get('scheduled') ?? 0,
    companies: companyCount,
    companyQueue: pendingCompanies,
    openings: openingsRows[0]?.total ?? 0,
    applications: applicationsTotal,
    subscribedCandidates: subscribed,
    staff: staffCount,
    employers: employerCount,
  }

  const revenueCollected = invoiceAmount.get('paid') ?? 0
  const revenueOutstanding = invoiceAmount.get('due') ?? 0
  const subscriptionRevenue = subscribedRows[0]?.amount ?? 0

  const funnel = [
    { label: 'Registered', value: employeeCount },
    { label: 'Subscribed', value: subscribed },
    { label: 'Resume verified', value: resumeCounts.get('verified') ?? 0 },
    { label: 'Mock cleared', value: mockCounts.get('completed') ?? 0 },
    { label: 'Shared', value: appsWithStatus('shared', 'interview', 'selected') },
    { label: 'Selected', value: appsWithStatus('selected') },
  ]

  const tracks = trackRows.map((r) => ({ label: r._id, value: r.count }))

  const upcomingMockInterviews = await MockInterview.find({ status: 'scheduled' })
    .populate('employee', 'name')
    .sort({ when: 1 })
    .limit(4)

  const activity = activityRows.map((a) => ({ text: a.text, time: formatRelative(a.createdAt), tone: a.tone }))

  res.json({ kpis, revenue: { collected: revenueCollected, outstanding: revenueOutstanding, subscriptions: subscriptionRevenue }, funnel, tracks, upcomingMockInterviews, activity })
})
