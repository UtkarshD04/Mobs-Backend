import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Application, { APPLICATION_STATUSES } from '../models/Application.js'
import Employee from '../models/Employee.js'
import { notifyEmployee } from '../utils/notifyEmployee.js'
import { STATUS_UPDATE_MESSAGES } from '../utils/applicationSync.js'
import { sendCsv } from '../utils/csv.js'

export const listApplications = asyncHandler(async (req, res) => {
  const { jobId, status } = req.query
  const query = {}

  if (jobId) query.job = jobId
  if (status && status !== 'all') query.status = status

  const { data, page, limit, total } = await paginate(Application, query, paginationParams(req), {
    sort: { premium: -1, appliedOn: -1 },
    populate: [
      // Enumerated resume subfields on purpose, not bare `resume` — Mongoose's
      // per-path `select: false` on `resume.s3Key` (see Employee.js) is only
      // honored when the path isn't explicitly named in an inclusion
      // projection, so a bare `resume` here would pull the storage key
      // straight into this response.
      { path: 'employee', select: 'name email skills experience resume.status resume.file resume.version resume.uploadedOn resume.score skillTrack' },
      { path: 'job', select: 'title company', populate: { path: 'company', select: 'name' } },
    ],
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

// GET /api/staff/applications/export — every application as a CSV (uncapped),
// same jobId/status filters as the list.
export const exportApplications = asyncHandler(async (req, res) => {
  const { jobId, status } = req.query
  const query = {}
  if (jobId) query.job = jobId
  if (status && status !== 'all') query.status = status

  const applications = await Application.find(query)
    .sort({ appliedOn: -1 })
    .populate({ path: 'employee', select: 'name email phone currentCity college graduation experience experienceYears' })
    .populate({ path: 'job', select: 'title company', populate: { path: 'company', select: 'name' } })
    .lean()

  const headers = [
    'Candidate', 'Email', 'Phone', 'City', 'College', 'Experience', 'Job', 'Company', 'Status', 'Fit %', 'Premium',
    'Applied On', 'Employer Viewed On', 'Rejection Reason', 'Rejected After', 'Internal Note',
  ]
  const rows = applications.map((a) => [
    a.employee?.name, a.employee?.email, a.employee?.phone, a.employee?.currentCity, a.employee?.college,
    a.employee?.experience === 'experienced' ? `Experienced (${a.employee.experienceYears ?? 0} yrs)` : 'Fresher',
    a.job?.title, a.job?.company?.name, a.status, a.fit, a.premium ? 'Yes' : 'No',
    a.appliedOn, a.employerViewedOn, a.rejectionReason, a.rejectedAfter, a.note,
  ])
  sendCsv(res, `applications-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
})

export const updateApplication = asyncHandler(async (req, res) => {
  const { status, note, rejectionReason } = req.body ?? {}
  const application = await Application.findById(req.params.id).populate('job', 'title')
  if (!application) return res.status(404).json({ message: 'Application not found' })

  const previousStatus = application.status
  if (status) {
    if (!APPLICATION_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' })
    }
    application.status = status
    if (status !== previousStatus) {
      application.statusHistory.push({ status, changedOn: new Date(), changedBy: 'staff' })
      application.rejectionReason = status === 'rejected' ? String(rejectionReason ?? '').trim().slice(0, 500) : ''
      application.rejectedAfter = status === 'rejected' ? previousStatus : ''
    }
  }
  if (note !== undefined) application.note = note

  await application.save()

  if (status && status !== previousStatus && STATUS_UPDATE_MESSAGES[status]) {
    const employee = await Employee.findById(application.employee)
    if (employee) {
      await notifyEmployee(employee, {
        category: 'applications',
        title: 'Application update',
        body: STATUS_UPDATE_MESSAGES[status](application.job?.title ?? 'a role', { reason: application.rejectionReason, after: application.rejectedAfter }),
      })
    }
  }

  res.json(application)
})
