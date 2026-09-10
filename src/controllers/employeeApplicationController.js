import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import { logActivity } from '../utils/activityLog.js'
import Application from '../models/Application.js'
import Candidate from '../models/Candidate.js'
import Batch from '../models/Batch.js'
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

  // Reaches the employer immediately — no staff dispatch step. Mirrors the
  // field-copy staffBatchController.dispatchBatch used to do manually.
  const candidate = await Candidate.create({
    company: job.company,
    job: job._id,
    batch: null,
    employee: employee._id,
    application: application._id,
    name: employee.name,
    headline: employee.resumeHeadline,
    appliedFor: job.title,
    experienceYears: employee.experienceYears,
    location: employee.currentCity,
    expectedSalary: employee.expectedSalaryMax ? `₹${employee.expectedSalaryMax}` : '',
    skills: employee.skills,
    education: employee.education,
    projects: employee.projects,
    workHistory: employee.workHistory,
    portfolioLink: employee.portfolioLink,
    email: employee.email,
    phone: employee.phone,
    resumeVerified: true,
    identityVerified: true,
    source: 'Mzobs Verified Pool',
    stage: 'shared',
    sharedOn: appliedOn,
  })

  // Mark the application as already delivered so it never gets picked up a
  // second time by staff's legacy dispatchBatch flow (which would otherwise
  // create a duplicate Candidate for it — see listEligibleApplications'
  // status filter in staffBatchController.js).
  application.status = 'shared'
  application.statusHistory.push({ status: 'shared', changedOn: appliedOn, changedBy: 'employee' })
  await application.save()

  job.candidatesShared = (job.candidatesShared ?? 0) + 1
  await job.save()

  // A Batch may or may not exist yet (it's created when staff records the
  // job's sourcing-fee payment) — it's a delivery-tracking record here, not
  // a gate, so link into it opportunistically when present.
  const batch = await Batch.findOne({ job: job._id })
  if (batch) {
    candidate.batch = batch._id
    await candidate.save()
    batch.dispatches.push({ application: application._id, dispatchedOn: appliedOn })
    batch.resumesDelivered += 1
    if (batch.resumesDelivered >= batch.resumesPromised) {
      batch.status = 'delivered'
      batch.deliveredOn = new Date()
    }
    await batch.save()
  }

  await logActivity(job.company, `New application received for "${job.title}"`, 'green')

  res.status(201).json(application)
})

// Applications reach the employer instantly (status goes straight to
// 'shared' in applyToJob), so 'shared' has to stay withdrawable too — once
// past that, the employer has started acting on it (interview/offer/etc.),
// which is where withdrawal stops making sense. Re-enforced here to match
// the same statuses the frontend's Withdraw button gates on.
const WITHDRAWABLE_STATUSES = ['new', 'screening', 'shortlisted', 'shared']

export const withdrawApplication = asyncHandler(async (req, res) => {
  const application = await Application.findOne({ _id: req.params.id, employee: req.employee._id })
  if (!application) return res.status(404).json({ message: 'Application not found' })

  if (!WITHDRAWABLE_STATUSES.includes(application.status)) {
    return res.status(409).json({ message: 'This application can no longer be withdrawn' })
  }

  application.status = 'withdrawn'
  application.statusHistory.push({ status: 'withdrawn', changedOn: new Date(), changedBy: 'employee' })
  await application.save()

  // The employer already has a Candidate record for this application (it's
  // created synchronously in applyToJob) — reflect the withdrawal there too
  // instead of leaving a stale "shared" row with no applicant behind it.
  await Candidate.findOneAndUpdate(
    { application: application._id, stage: { $nin: ['hired', 'rejected'] } },
    { stage: 'rejected', rejectionReason: 'Candidate withdrew this application' }
  )

  res.json(application)
})
