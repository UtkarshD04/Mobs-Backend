import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import Employee from '../models/Employee.js'
import Company from '../models/Company.js'
import Job from '../models/Job.js'
import Application from '../models/Application.js'
import MockInterview from '../models/MockInterview.js'
import Invoice from '../models/Invoice.js'
import StaffActivity from '../models/StaffActivity.js'

const sum = (rows, field) => rows.reduce((total, r) => total + (r[field] ?? 0), 0)

export const getDashboard = asyncHandler(async (req, res) => {
  const [employees, companies, jobs, applications, mockInterviews, invoices, activityRows] = await Promise.all([
    Employee.find({}).select('name resume subscription skillTrack'),
    Company.find({}).select('name verificationStatus'),
    Job.find({}).select('status'),
    Application.find({}).select('status'),
    MockInterview.find({}).select('status when'),
    Invoice.find({}).select('amount status'),
    StaffActivity.find({}).sort({ createdAt: -1 }).limit(8),
  ])

  const kpis = {
    candidates: employees.length,
    resumeQueue: employees.filter((e) => e.resume?.status === 'pending').length,
    mockQueue: mockInterviews.filter((m) => m.status === 'scheduled').length,
    companyQueue: companies.filter((c) => c.verificationStatus === 'pending').length,
    openings: sum(
      jobs.filter((j) => !['draft', 'closed', 'archived'].includes(j.status)),
      'vacancies'
    ),
    applications: applications.length,
  }

  const revenueCollected = sum(
    invoices.filter((i) => i.status === 'paid'),
    'amount'
  )
  const revenueOutstanding = sum(
    invoices.filter((i) => i.status === 'due'),
    'amount'
  )
  const subscriptionRevenue = employees
    .filter((e) => e.subscription?.status === 'paid')
    .reduce((total, e) => total + (e.subscription?.amount ?? 0), 0)

  const funnel = [
    { label: 'Registered', value: employees.length },
    { label: 'Subscribed', value: employees.filter((e) => e.subscription?.status === 'paid').length },
    { label: 'Resume verified', value: employees.filter((e) => e.resume?.status === 'verified').length },
    { label: 'Mock cleared', value: mockInterviews.filter((m) => m.status === 'completed').length },
    { label: 'Shared', value: applications.filter((a) => ['shared', 'interview', 'selected'].includes(a.status)).length },
    { label: 'Selected', value: applications.filter((a) => a.status === 'selected').length },
  ]

  const trackCounts = new Map()
  employees.forEach((e) => {
    const key = e.skillTrack?.key
    if (key) trackCounts.set(key, (trackCounts.get(key) ?? 0) + 1)
  })
  const tracks = [...trackCounts.entries()].map(([label, value]) => ({ label, value }))

  const upcomingMockInterviews = await MockInterview.find({ status: 'scheduled' })
    .populate('employee', 'name')
    .sort({ when: 1 })
    .limit(4)

  const activity = activityRows.map((a) => ({ text: a.text, time: formatRelative(a.createdAt), tone: a.tone }))

  res.json({ kpis, revenue: { collected: revenueCollected, outstanding: revenueOutstanding, subscriptions: subscriptionRevenue }, funnel, tracks, upcomingMockInterviews, activity })
})
