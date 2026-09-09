import { asyncHandler } from '../utils/asyncHandler.js'
import { parseJobFilters, buildJobQuery, buildSortStage, escapeRegex, PUBLIC_STATUSES } from '../utils/jobQueryFilters.js'
import { matchRank, buildSuggestions, buildGroupedSuggestions, MAX_SUGGESTIONS } from '../utils/jobSuggestions.js'
import { POPULAR_JOB_TITLES, POPULAR_CITIES, POPULAR_SKILLS } from '../config/jobSuggestionsFallback.js'
import { HOT_CITIES, aggregateHotCities } from '../utils/hotCities.js'
import Job from '../models/Job.js'
import Company from '../models/Company.js'

// This whole file is the public, unauthenticated surface the marketing site
// (Website/Landing-Frontend) searches against directly — no employee account
// needed. It's a deliberately smaller, teaser-shaped sibling of the
// employee-facing job board (Backend/src/controllers/employeePublicJobsController.js
// + GET /api/employee/jobs) rather than a re-export of it: same safe,
// allowlisted query-building (jobQueryFilters.js) and the same
// exact/starts-with/contains suggestion ranking (jobSuggestions.js), but
// capped harder (20 jobs/page max, not 200) since this endpoint has no auth
// gate in front of it at all.

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
    experienceMin: job.experienceMin,
    experienceMax: job.experienceMax,
    salary: job.salaryMin && job.salaryMax ? `${formatINR(job.salaryMin)} – ${formatINR(job.salaryMax)}` : 'Depends on interview & experience',
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    workMode: job.workMode,
    employmentType: job.employmentType,
    track: job.track,
    vacancies: job.vacancies,
    postedDaysAgo,
    // Raw postedOn/deadline (on top of the derived postedDaysAgo above) —
    // needed for JobPosting structured data (datePosted/validThrough) on the
    // Landing Frontend's public job pages. `deadline` stays free-text as
    // recruiters enter it (see Job.js); the frontend parses it best-effort.
    postedOn: postedOn ? new Date(postedOn).toISOString() : null,
    deadline: job.deadline || '',
    description: job.description,
    skills: job.skills,
    benefits: job.benefits,
  }
}

// `q` can match a company name, but company name lives on the Company doc,
// not Job — resolve the small set of matching company ids up front so
// buildJobQuery can stay a pure, DB-free function. Mirrors the identical
// helper in employeePublicJobsController.js; kept as its own small copy
// here rather than a shared import so this public surface has zero runtime
// coupling to the employee-facing controller.
async function resolveMatchingCompanyIds(qTerms) {
  if (!qTerms?.length) return []
  const regex = new RegExp(qTerms.map(escapeRegex).join('|'), 'i')
  const companies = await Company.find({ name: regex }).select('_id').lean()
  return companies.map((c) => c._id)
}

// Public teaser pagination — capped far below the employee board's (200/page)
// since nothing gates access to this endpoint. 8 jobs by default (matches
// the "Latest jobs" section's original curated-sample size), 20 max.
function teaserPaginationParams(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const limit = Math.min(20, Math.max(1, Number.parseInt(req.query.limit, 10) || 8))
  return { page, limit, skip: (page - 1) * limit }
}

// Public, unauthenticated, filterable feed for the Landing Frontend's
// "Latest jobs" section — only jobs admin/ops have approved and pushed live
// (visibleToCandidates + sourcing/delivered) ever show up here. Supports the
// same q/location/experience/workMode/salary/employmentType/track/
// postedWithin/sort filters as the employee job board, all parsed through
// the same allowlisting/regex-escaping in jobQueryFilters.js — nothing here
// ever accepts a raw Mongo operator from the query string.
export const listLatestJobs = asyncHandler(async (req, res) => {
  const filters = parseJobFilters(req.query)
  const matchingCompanyIdsForQ = await resolveMatchingCompanyIds(filters.q)
  const query = buildJobQuery(filters, { matchingCompanyIdsForQ })
  const { page, limit, skip } = teaserPaginationParams(req)
  const sort = buildSortStage(filters)

  const [jobs, total] = await Promise.all([
    Job.find(query).populate('company', 'name logo').sort(sort).skip(skip).limit(limit),
    Job.countDocuments(query),
  ])

  res.set('X-Total-Count', String(total))
  res.set('X-Page', String(page))
  res.set('X-Limit', String(limit))
  res.json(jobs.map(toLatestJobSummary))
})

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/

// One job, teaser-shaped — backs the standalone job description page
// (Landing Frontend's pages/JobDetail.jsx) for a direct/refreshed visit to
// /jobs/:id, where there's no in-page state to read the job from. A card
// click normally carries the job across via router state instead, so this
// only round-trips when that state is missing.
export const getLatestJob = asyncHandler(async (req, res) => {
  if (!OBJECT_ID_RE.test(req.params.id)) return res.status(404).json({ message: 'Job not found' })
  const job = await Job.findOne({ _id: req.params.id, visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } }).populate(
    'company',
    'name logo'
  )
  if (!job) return res.status(404).json({ message: 'Job not found' })
  res.json(toLatestJobSummary(job))
})

// Counted, grouped values across every candidate-visible, publicly-listed
// job — the raw material for both the location-suggestion list and the
// title/skill/company suggestion groups below.
function groupValueCounts(field) {
  return Job.aggregate([
    { $match: { visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]).then((rows) => rows.filter((r) => r._id).map((r) => ({ value: r._id, count: r.count })))
}

function groupSkillCounts() {
  return Job.aggregate([
    { $match: { visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } } },
    { $unwind: '$skills' },
    { $group: { _id: '$skills', count: { $sum: 1 } } },
  ]).then((rows) => rows.filter((r) => r._id).map((r) => ({ value: r._id, count: r.count })))
}

// Real, live companies only — no curated padding here (a "safe public
// company" list would just be fabricated employer names), ranked the same
// exact/starts-with/contains way as everything else.
function groupCompanyCounts() {
  return Job.aggregate([
    { $match: { visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } } },
    { $group: { _id: '$company', count: { $sum: 1 } } },
    { $lookup: { from: 'companies', localField: '_id', foreignField: '_id', as: 'company' } },
    { $unwind: '$company' },
    { $project: { _id: 0, value: '$company.name', id: '$_id', count: 1 } },
  ])
}

// Job-title/skill/company and city/location autocomplete for the Landing
// Frontend's home-page search bar. Real counts always come from
// candidate-visible jobs only; the curated fallbacks (jobSuggestionsFallback.js)
// only ever pad a sparse live list — see buildSuggestions — and never
// surface anything private. `type=location` powers the "City, state or
// Remote" box; `type=title` (titles only) and the default/`type=all`
// (titles + skills + companies, grouped in that order) power the "Job
// title, skill or company" box.
export const getPublicJobSuggestions = asyncHandler(async (req, res) => {
  const rawType = req.query.type
  const type = rawType === 'location' ? 'location' : rawType === 'title' ? 'title' : 'all'
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : ''
  const limit = Math.min(MAX_SUGGESTIONS, Math.max(1, Number.parseInt(req.query.limit, 10) || MAX_SUGGESTIONS))

  if (type === 'location') {
    const [cityRows, remoteCount] = await Promise.all([
      groupValueCounts('location'),
      Job.countDocuments({
        visibleToCandidates: true,
        status: { $in: PUBLIC_STATUSES },
        $or: [{ workMode: 'Remote' }, { location: /^remote$/i }],
      }),
    ])

    // "Remote" is a fixed, prominent option (not part of the curated city
    // list) — it only drops out of the results if the typed text plainly
    // doesn't match it, same rank logic as everything else.
    const remoteRelevant = matchRank('Remote', query) !== null
    const cityItems = buildSuggestions({
      liveRows: cityRows,
      curatedValues: POPULAR_CITIES,
      query,
      limit: remoteRelevant ? limit - 1 : limit,
    }).map((item) => ({ ...item, kind: 'location' }))
    const items = remoteRelevant ? [{ value: 'Remote', count: remoteCount, source: 'live', kind: 'remote' }, ...cityItems] : cityItems

    return res.json({ type: 'location', query, items })
  }

  if (type === 'title') {
    const titleRows = await groupValueCounts('title')
    const items = buildSuggestions({ liveRows: titleRows, curatedValues: POPULAR_JOB_TITLES, query, limit }).map((item) => ({
      ...item,
      kind: 'title',
    }))
    return res.json({ type: 'title', query, items })
  }

  // type === 'all' — the combined title + skill + company box.
  const [titleRows, skillRows, companyRows] = await Promise.all([groupValueCounts('title'), groupSkillCounts(), groupCompanyCounts()])
  const items = buildGroupedSuggestions({
    titles: { live: titleRows, curated: POPULAR_JOB_TITLES },
    skills: { live: skillRows, curated: POPULAR_SKILLS },
    companies: { live: companyRows, curated: [] },
    query,
    limit,
  })

  res.json({ type: 'all', query, items })
})

// Real, live counts for the Landing Frontend's "Explore jobs by category"
// tiles — `tracks` mirrors the Job.track enum exactly (tech/sales/marketing/
// design/hr/ops/support), so content.js just looks up its own category by
// track key rather than this endpoint knowing anything about marketing-site
// category titles. `freshers`/`remote` are counted through the exact same
// buildJobQuery a click on those tiles would filter with (experience=0-1 /
// location=Remote), so the number shown always matches what browsing there
// actually returns. `finance` has no Job.track value to group by (see the
// enum on Job.js) — Finance postings only ever land in the free-text
// `department` field, so it's counted by matching that instead, same as
// every other number here: a real query result, never a hardcoded figure.
export const getPublicCategoryCounts = asyncHandler(async (req, res) => {
  const baseMatch = { visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } }
  const [trackRows, freshers, remote, finance] = await Promise.all([
    Job.aggregate([{ $match: baseMatch }, { $group: { _id: '$track', count: { $sum: 1 } } }]),
    Job.countDocuments(buildJobQuery(parseJobFilters({ experience: '0-1' }))),
    Job.countDocuments(buildJobQuery(parseJobFilters({ location: 'Remote' }))),
    Job.countDocuments({ ...baseMatch, department: /finance|accounting/i }),
  ])

  const tracks = {}
  trackRows.forEach((row) => {
    if (row._id) tracks[row._id] = row.count
  })

  res.json({ tracks, freshers, remote, finance })
})

// Real, live per-city × category stats for the Landing Frontend's "Hot Jobs
// by City" section — see hotCities.js for the aggregation itself (pure,
// unit-tested, no DB access) and HOT_CITIES for the curated city list. One
// query, bounded to jobs whose free-text location actually matches one of
// those cities (not the whole public jobs collection), then reduced in JS —
// cheaper than 60 separate city×filter round trips.
export const getPublicHotCities = asyncHandler(async (req, res) => {
  const jobs = await Job.find({
    visibleToCandidates: true,
    status: { $in: PUBLIC_STATUSES },
    location: { $in: HOT_CITIES.map((c) => c.match) },
  })
    .select('location track department salaryMin salaryMax postedOn createdAt company')
    .populate('company', 'verificationStatus')
    .lean()

  res.json({ cities: aggregateHotCities(jobs) })
})
