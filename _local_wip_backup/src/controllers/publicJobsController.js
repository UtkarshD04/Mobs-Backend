import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import Job from '../models/Job.js'

const MAX_LIMIT = 12

// Anonymous marketing-site teaser — deliberately thinner than the
// employee-authenticated job board response (employeePublicJobsController.js):
// no salary, description, benefits or skills, so browsing the homepage isn't
// a substitute for actually creating an account to see full listings.
function teaserJob(job) {
  return {
    id: job._id.toString(),
    company: job.company?.name ?? '',
    logo: job.company?.logo ?? '',
    title: job.title,
    location: job.location,
    employmentType: job.employmentType,
    workMode: job.workMode,
    experienceMin: job.experienceMin,
    experienceMax: job.experienceMax,
    posted: job.postedOn ? formatRelative(job.postedOn) : '',
  }
}

// Only jobs staff have approved and released to the candidate-facing board
// (same gate as GET /api/employee/jobs) are eligible — this never exposes
// draft, pending-review, or awaiting-payment postings.
export const listFeaturedJobs = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || MAX_LIMIT, MAX_LIMIT)
  const jobs = await Job.find({ visibleToCandidates: true, status: { $in: ['sourcing', 'delivered'] } })
    .populate('company', 'name logo')
    .sort({ postedOn: -1 })
    .limit(limit)
  res.json(jobs.map(teaserJob))
})
