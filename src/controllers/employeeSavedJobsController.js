import { asyncHandler } from '../utils/asyncHandler.js'
import SavedJob from '../models/SavedJob.js'
import Job from '../models/Job.js'
import { publicJob } from './employeePublicJobsController.js'
import { PUBLIC_STATUSES } from '../utils/jobQueryFilters.js'

export const listSavedJobs = asyncHandler(async (req, res) => {
  const saved = await SavedJob.find({ employee: req.employee._id }).sort({ createdAt: -1 })
  const jobIds = saved.map((s) => s.job)
  const jobs = await Job.find({ _id: { $in: jobIds }, visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } }).populate('company', 'name logo')
  const byId = new Map(jobs.map((j) => [j._id.toString(), j]))
  // Preserve save order; silently drop any job that's since been unpublished.
  const ordered = saved.map((s) => byId.get(s.job.toString())).filter(Boolean)
  res.json(ordered.map(publicJob))
})

export const saveJob = asyncHandler(async (req, res) => {
  const { jobId } = req.body ?? {}
  if (!jobId) return res.status(400).json({ message: 'jobId is required' })

  const job = await Job.findOne({ _id: jobId, visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } })
  if (!job) return res.status(404).json({ message: 'Job not found' })

  // Idempotent — saving an already-saved job just confirms the existing bookmark.
  await SavedJob.findOneAndUpdate({ employee: req.employee._id, job: job._id }, {}, { upsert: true, setDefaultsOnInsert: true })
  res.status(201).json({ jobId: job._id.toString(), saved: true })
})

export const unsaveJob = asyncHandler(async (req, res) => {
  await SavedJob.deleteOne({ employee: req.employee._id, job: req.params.jobId })
  res.json({ jobId: req.params.jobId, saved: false })
})
