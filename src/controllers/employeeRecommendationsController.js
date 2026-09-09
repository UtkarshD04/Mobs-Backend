import { asyncHandler } from '../utils/asyncHandler.js'
import Job from '../models/Job.js'
import Application from '../models/Application.js'
import { publicJob } from './employeePublicJobsController.js'
import { PUBLIC_STATUSES } from '../utils/jobQueryFilters.js'
import { rankJobsForEmployee } from '../utils/jobMatching.js'

const CANDIDATE_POOL_SIZE = 300
const RESULT_LIMIT = 20

export const getRecommendedJobs = asyncHandler(async (req, res) => {
  const employee = req.employee
  const sort = ['match', 'newest', 'salary_desc', 'salary_asc'].includes(req.query.sort) ? req.query.sort : 'match'

  const appliedJobIds = await Application.find({ employee: employee._id }).distinct('job')

  const pool = await Job.find({
    visibleToCandidates: true,
    status: { $in: PUBLIC_STATUSES },
    _id: { $nin: appliedJobIds },
  })
    .populate('company', 'name logo')
    .sort({ postedOn: -1 })
    .limit(CANDIDATE_POOL_SIZE)

  let ranked = rankJobsForEmployee(employee, pool, { limit: RESULT_LIMIT })

  if (sort === 'newest') ranked = [...ranked].sort((a, b) => new Date(b.job.postedOn ?? 0) - new Date(a.job.postedOn ?? 0))
  else if (sort === 'salary_desc') ranked = [...ranked].sort((a, b) => (b.job.salaryMax ?? 0) - (a.job.salaryMax ?? 0))
  else if (sort === 'salary_asc') ranked = [...ranked].sort((a, b) => (a.job.salaryMin ?? 0) - (b.job.salaryMin ?? 0))

  res.json(
    ranked.map(({ job, score, reasons }) => ({
      ...publicJob(job),
      matchScore: score,
      matchReasons: reasons,
    }))
  )
})
