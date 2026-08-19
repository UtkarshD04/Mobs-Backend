import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Application from '../models/Application.js'
import Job from '../models/Job.js'
import MockInterview from '../models/MockInterview.js'

function fitScore(employeeSkills = [], jobSkills = []) {
  if (jobSkills.length === 0) return null
  const set = new Set(employeeSkills.map((s) => s.toLowerCase()))
  const matches = jobSkills.filter((s) => set.has(s.toLowerCase())).length
  return Math.round((matches / jobSkills.length) * 100)
}

export const listApplications = asyncHandler(async (req, res) => {
  const { data, page, limit, total } = await paginate(Application, { employee: req.employee._id }, paginationParams(req), {
    sort: { appliedOn: -1 },
    populate: { path: 'job', select: 'title department location workMode company' },
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const applyToJob = asyncHandler(async (req, res) => {
  const { jobId } = req.body ?? {}
  if (!jobId) return res.status(400).json({ message: 'jobId is required' })

  const employee = req.employee
  if (employee.resume?.status !== 'verified') {
    return res.status(403).json({ message: 'Your resume must be verified before you can apply' })
  }

  const mockInterview = await MockInterview.findOne({ employee: employee._id })
  if (mockInterview?.status !== 'completed') {
    return res.status(403).json({ message: 'You must complete your Mzobs verification interview before you can apply' })
  }

  const job = await Job.findOne({ _id: jobId, visibleToCandidates: true, status: { $in: ['sourcing', 'delivered'] } })
  if (!job) return res.status(404).json({ message: 'Job not found' })

  const existing = await Application.findOne({ employee: employee._id, job: job._id })
  if (existing) return res.status(409).json({ message: 'You have already applied to this job' })

  const application = await Application.create({
    employee: employee._id,
    job: job._id,
    status: 'new',
    fit: fitScore(employee.skills, job.skills),
    appliedOn: new Date(),
  })

  res.status(201).json(application)
})
