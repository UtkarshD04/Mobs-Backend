import { asyncHandler } from '../utils/asyncHandler.js'
import { logActivity } from '../utils/activityLog.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Batch from '../models/Batch.js'
import Application from '../models/Application.js'
import Candidate from '../models/Candidate.js'
import Job from '../models/Job.js'

export const listBatches = asyncHandler(async (req, res) => {
  const { status } = req.query
  const query = {}
  if (status && status !== 'all') query.status = status

  const { data, page, limit, total } = await paginate(Batch, query, paginationParams(req), {
    sort: { createdAt: -1 },
    populate: { path: 'company', select: 'name logo' },
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const getBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id).populate('company', 'name logo')
  if (!batch) return res.status(404).json({ message: 'Batch not found' })
  res.json(batch)
})

// Applications that are ready to go into this batch's next dispatch round:
// verified resume, completed mock interview, not already shared/rejected.
export const listEligibleApplications = asyncHandler(async (req, res) => {
  const batch = await Batch.findById(req.params.id)
  if (!batch) return res.status(404).json({ message: 'Batch not found' })

  const applications = await Application.find({ job: batch.job, status: { $in: ['new', 'screening', 'shortlisted'] } })
    .populate({
      path: 'employee',
      match: { 'resume.status': 'verified' },
      select: 'name email phone skills experience experienceYears location resume skillTrack education projects workHistory portfolioLink',
    })
    .sort({ fit: -1 })
    .limit(500)

  res.json(applications.filter((a) => a.employee))
})

// The core integration point: turns staff-picked Applications into real
// employer-visible Candidate records under the batch's Job/Company.
export const dispatchBatch = asyncHandler(async (req, res) => {
  const { applicationIds } = req.body ?? {}
  if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
    return res.status(400).json({ message: 'applicationIds is required' })
  }

  const batch = await Batch.findById(req.params.id)
  if (!batch) return res.status(404).json({ message: 'Batch not found' })

  const applications = await Application.find({
    _id: { $in: applicationIds },
    job: batch.job,
    status: { $in: ['new', 'screening', 'shortlisted'] },
  }).populate('employee')

  if (applications.length === 0) {
    return res.status(400).json({ message: 'No eligible applications in the selection' })
  }

  const job = await Job.findById(batch.job)
  const createdCandidates = []

  for (const application of applications) {
    const employee = application.employee
    if (!employee || employee.resume?.status !== 'verified') continue

    const candidate = await Candidate.create({
      company: batch.company,
      job: batch.job,
      batch: batch._id,
      employee: employee._id,
      application: application._id,
      name: employee.name,
      headline: employee.resumeHeadline,
      appliedFor: job?.title ?? batch.jobTitle,
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
      sharedOn: new Date(),
    })
    createdCandidates.push(candidate)

    application.status = 'shared'
    await application.save()

    batch.dispatches.push({ application: application._id, dispatchedOn: new Date() })
  }

  batch.resumesDelivered += createdCandidates.length
  if (batch.resumesDelivered >= batch.resumesPromised) {
    batch.status = 'delivered'
    batch.deliveredOn = new Date()
  }
  await batch.save()

  if (job) {
    job.candidatesShared = (job.candidatesShared ?? 0) + createdCandidates.length
    await job.save()
    await logActivity(batch.company, `${createdCandidates.length} new resume${createdCandidates.length === 1 ? '' : 's'} shared for "${job.title}"`, 'green')
  }
  await logStaffActivity(`Dispatched ${createdCandidates.length} resume${createdCandidates.length === 1 ? '' : 's'} for "${batch.jobTitle}"`, 'green')

  res.status(201).json({ batch, candidates: createdCandidates })
})
