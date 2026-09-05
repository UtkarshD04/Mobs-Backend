import { asyncHandler } from '../utils/asyncHandler.js'
import Job from '../models/Job.js'

function formatINR(n) {
  if (n >= 10000000) return '₹' + (n / 10000000).toFixed(1).replace(/\.0$/, '') + 'Cr'
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1).replace(/\.0$/, '') + 'L'
  if (n >= 1000) return '₹' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K'
  return '₹' + n
}

// Teaser shape for the marketing site's "Latest jobs" home page section —
// pre-formatted strings so that unauthenticated section has no reason to
// carry any raw fee/invoice/sourcing data, just what's safe to show anyone.
function toLatestJobSummary(job) {
  const postedOn = job.postedOn ?? job.createdAt
  const postedDaysAgo = postedOn ? Math.max(0, Math.floor((Date.now() - new Date(postedOn).getTime()) / 86400000)) : 0

  return {
    id: job._id.toString(),
    title: job.title,
    company: job.company?.name ?? '',
    location: job.location,
    experience: job.experienceMin != null && job.experienceMax != null ? `${job.experienceMin}–${job.experienceMax} yrs` : '',
    salary: job.salaryMin && job.salaryMax ? `${formatINR(job.salaryMin)} – ${formatINR(job.salaryMax)}` : '',
    workMode: job.workMode,
    employmentType: job.employmentType,
    vacancies: job.vacancies,
    postedDaysAgo,
    description: job.description,
    skills: job.skills,
    benefits: job.benefits,
  }
}

// Public, unauthenticated feed — only jobs admin/ops have approved and
// pushed live (same visibleToCandidates + sourcing/delivered gate as the
// employee-facing job board) show up here.
export const listLatestJobs = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 8, 20)
  const jobs = await Job.find({ visibleToCandidates: true, status: { $in: ['sourcing', 'delivered'] } })
    .populate('company', 'name logo')
    .sort({ postedOn: -1 })
    .limit(limit)
  res.json(jobs.map(toLatestJobSummary))
})
