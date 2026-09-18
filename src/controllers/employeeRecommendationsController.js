import { asyncHandler } from '../utils/asyncHandler.js'
import Job from '../models/Job.js'
import Application from '../models/Application.js'
import { publicJob } from './employeePublicJobsController.js'
import { PUBLIC_STATUSES } from '../utils/jobQueryFilters.js'
import { rankJobsForEmployee } from '../utils/jobMatching.js'

const CANDIDATE_POOL_SIZE = 300
const RESULT_LIMIT = 20
// Premium candidates get a wider, deeper result set from the same fair
// scoring — not a score boost, just more of the pool to rank against.
const PREMIUM_CANDIDATE_POOL_SIZE = 600
const PREMIUM_RESULT_LIMIT = 40

export const getRecommendedJobs = asyncHandler(async (req, res) => {
  const employee = req.employee
  const sort = ['match', 'newest', 'salary_desc', 'salary_asc'].includes(req.query.sort) ? req.query.sort : 'match'
  const poolSize = employee.isPremium ? PREMIUM_CANDIDATE_POOL_SIZE : CANDIDATE_POOL_SIZE
  const resultLimit = employee.isPremium ? PREMIUM_RESULT_LIMIT : RESULT_LIMIT

  const appliedJobIds = await Application.find({ employee: employee._id }).distinct('job')

  const pool = await Job.find({
    visibleToCandidates: true,
    status: { $in: PUBLIC_STATUSES },
    _id: { $nin: appliedJobIds },
  })
    .populate('company', 'name logo')
    .sort({ postedOn: -1 })
    .limit(poolSize)

  let ranked = rankJobsForEmployee(employee, pool, { limit: resultLimit })

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
