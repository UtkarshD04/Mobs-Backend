import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import { paginationParams, setPaginationHeaders } from '../utils/paginate.js'
import Job from '../models/Job.js'

// Public/employee-safe view of a job — no fee, invoice, or internal sourcing data.
function publicJob(job) {
  return {
    id: job._id.toString(),
    company: job.company?.name ?? '',
    logo: job.company?.logo ?? '',
    title: job.title,
    department: job.department,
    employmentType: job.employmentType,
    experienceMin: job.experienceMin,
    experienceMax: job.experienceMax,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    vacancies: job.vacancies,
    location: job.location,
    workMode: job.workMode,
    skills: job.skills,
    track: job.track,
    description: job.description,
    benefits: job.benefits,
    deadline: job.deadline,
    postedOn: job.postedOn,
    posted: job.postedOn ? formatRelative(job.postedOn) : '',
  }
}

export const listPublicJobs = asyncHandler(async (req, res) => {
  const { track, search } = req.query
  const query = { visibleToCandidates: true, status: { $in: ['sourcing', 'delivered'] } }

  if (track && track !== 'all') query.track = track
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ title: regex }, { skills: regex }, { location: regex }]
  }

  const { page, limit, skip } = paginationParams(req)
  const [jobs, total] = await Promise.all([
    Job.find(query).populate('company', 'name logo').sort({ postedOn: -1 }).skip(skip).limit(limit),
    Job.countDocuments(query),
  ])
  setPaginationHeaders(res, { page, limit, total })
  res.json(jobs.map(publicJob))
})

export const getPublicJob = asyncHandler(async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, visibleToCandidates: true, status: { $in: ['sourcing', 'delivered'] } }).populate(
    'company',
    'name logo'
  )
  if (!job) return res.status(404).json({ message: 'Job not found' })
  res.json(publicJob(job))
})
