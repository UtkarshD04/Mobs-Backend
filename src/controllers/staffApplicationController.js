import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Application from '../models/Application.js'
import Employee from '../models/Employee.js'
import { notifyEmployee } from '../utils/notifyEmployee.js'

const STATUS_UPDATE_MESSAGES = {
  screening: (job) => `Your application for ${job} is now under screening.`,
  shortlisted: (job) => `Your application for ${job} has been shortlisted.`,
  shared: (job) => `Your profile for ${job} has been shared with the employer.`,
  interview: (job) => `Your application for ${job} has moved to the interview stage.`,
  selected: (job) => `You've been selected for ${job}. Congratulations!`,
  rejected: (job) => `Your application for ${job} was not selected this time.`,
}

export const listApplications = asyncHandler(async (req, res) => {
  const { jobId, status } = req.query
  const query = {}

  if (jobId) query.job = jobId
  if (status && status !== 'all') query.status = status

  const { data, page, limit, total } = await paginate(Application, query, paginationParams(req), {
    sort: { appliedOn: -1 },
    populate: [
      { path: 'employee', select: 'name email skills experience resume skillTrack' },
      { path: 'job', select: 'title company', populate: { path: 'company', select: 'name' } },
    ],
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const updateApplication = asyncHandler(async (req, res) => {
  const { status, note } = req.body ?? {}
  const application = await Application.findById(req.params.id).populate('job', 'title')
  if (!application) return res.status(404).json({ message: 'Application not found' })

  const previousStatus = application.status
  if (status) {
    if (!['new', 'screening', 'shortlisted', 'shared', 'interview', 'selected', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' })
    }
    application.status = status
  }
  if (note !== undefined) application.note = note

  await application.save()

  if (status && status !== previousStatus && STATUS_UPDATE_MESSAGES[status]) {
    const employee = await Employee.findById(application.employee)
    if (employee) {
      await notifyEmployee(employee, {
        category: 'applications',
        title: 'Application update',
        body: STATUS_UPDATE_MESSAGES[status](application.job?.title ?? 'a role'),
      })
    }
  }

  res.json(application)
})
