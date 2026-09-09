import { asyncHandler } from '../utils/asyncHandler.js'
import RecentlyViewedJob from '../models/RecentlyViewedJob.js'
import Job from '../models/Job.js'
import { publicJob } from './employeePublicJobsController.js'
import { PUBLIC_STATUSES } from '../utils/jobQueryFilters.js'

const RECENT_LIMIT = 20

export const listRecentlyViewed = asyncHandler(async (req, res) => {
  const rows = await RecentlyViewedJob.find({ employee: req.employee._id }).sort({ viewedOn: -1 }).limit(RECENT_LIMIT)
  const jobIds = rows.map((r) => r.job)
  const jobs = await Job.find({ _id: { $in: jobIds }, visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } }).populate('company', 'name logo')
  const byId = new Map(jobs.map((j) => [j._id.toString(), j]))
  const ordered = rows.map((r) => byId.get(r.job.toString())).filter(Boolean)
  res.json(ordered.map(publicJob))
})

export const recordView = asyncHandler(async (req, res) => {
  const { jobId } = req.body ?? {}
  if (!jobId) return res.status(400).json({ message: 'jobId is required' })

  const job = await Job.findOne({ _id: jobId, visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } }).select('_id')
  if (!job) return res.status(404).json({ message: 'Job not found' })

  await RecentlyViewedJob.findOneAndUpdate({ employee: req.employee._id, job: job._id }, { viewedOn: new Date() }, { upsert: true, setDefaultsOnInsert: true })
  res.status(204).end()
})
