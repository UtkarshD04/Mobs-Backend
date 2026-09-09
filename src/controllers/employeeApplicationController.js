import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Application from '../models/Application.js'
import Job from '../models/Job.js'

function fitScore(employeeSkills = [], jobSkills = []) {
  if (jobSkills.length === 0) return null
  const set = new Set(employeeSkills.map((s) => s.toLowerCase()))
  const matches = jobSkills.filter((s) => set.has(s.toLowerCase())).length
  return Math.round((matches / jobSkills.length) * 100)
}

export const listApplications = asyncHandler(async (req, res) => {
  const { data, page, limit, total } = await paginate(Application, { employee: req.employee._id }, paginationParams(req), {
    sort: { appliedOn: -1 },
    populate: {
      path: 'job',
      select: 'title department location workMode company',
      populate: { path: 'company', select: 'name logo' },
    },
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

  const job = await Job.findOne({ _id: jobId, visibleToCandidates: true, status: { $in: ['sourcing', 'delivered'] } })
  if (!job) return res.status(404).json({ message: 'Job not found' })

  const existing = await Application.findOne({ employee: employee._id, job: job._id })
  if (existing) return res.status(409).json({ message: 'You have already applied to this job' })

  const appliedOn = new Date()
  const application = await Application.create({
    employee: employee._id,
    job: job._id,
    status: 'new',
    statusHistory: [{ status: 'new', changedOn: appliedOn, changedBy: 'employee' }],
    fit: fitScore(employee.skills, job.skills),
    appliedOn,
  })

  res.status(201).json(application)
})

// Withdrawal is only offered while the application is still with Mzobs —
// once it's been shared with the employer (or later), pulling it back isn't
// meaningful, so the same statuses that gate the frontend's Withdraw button
// are re-enforced here server-side.
const WITHDRAWABLE_STATUSES = ['new', 'screening', 'shortlisted']

export const withdrawApplication = asyncHandler(async (req, res) => {
  const application = await Application.findOne({ _id: req.params.id, employee: req.employee._id })
  if (!application) return res.status(404).json({ message: 'Application not found' })

  if (!WITHDRAWABLE_STATUSES.includes(application.status)) {
    return res.status(409).json({ message: 'This application can no longer be withdrawn' })
  }

  application.status = 'withdrawn'
  application.statusHistory.push({ status: 'withdrawn', changedOn: new Date(), changedBy: 'employee' })
  await application.save()

  res.json(application)
})
