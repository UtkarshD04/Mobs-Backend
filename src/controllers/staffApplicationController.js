import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Application from '../models/Application.js'

export const listApplications = asyncHandler(async (req, res) => {
  const { jobId, status } = req.query
  const query = {}

  if (jobId) query.job = jobId
  if (status && status !== 'all') query.status = status

  const { data, page, limit, total } = await paginate(Application, query, paginationParams(req), {
    sort: { appliedOn: -1 },
    populate: [
      { path: 'employee', select: 'name email skills experience resume skillTrack' },
      { path: 'job', select: 'title company' },
    ],
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const updateApplication = asyncHandler(async (req, res) => {
  const { status, note } = req.body ?? {}
  const application = await Application.findById(req.params.id)
  if (!application) return res.status(404).json({ message: 'Application not found' })

  if (status) {
    if (!['new', 'screening', 'shortlisted', 'shared', 'interview', 'selected', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' })
    }
    application.status = status
  }
  if (note !== undefined) application.note = note

  await application.save()
  res.json(application)
})
