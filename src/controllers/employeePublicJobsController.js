import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import { paginationParams, setPaginationHeaders } from '../utils/paginate.js'
import { parseJobFilters, buildJobQuery, buildSortStage, escapeRegex, publicJobFilter, EXPERIENCE_RANGES, SALARY_RANGES, POSTED_WITHIN_DAYS } from '../utils/jobQueryFilters.js'
import { isValidCoord, nearbyJobsPage } from '../utils/geo.js'
import { matchRank, buildSuggestions, MAX_SUGGESTIONS } from '../utils/jobSuggestions.js'
import { POPULAR_JOB_TITLES, POPULAR_CITIES } from '../config/jobSuggestionsFallback.js'
import Job from '../models/Job.js'
import Company from '../models/Company.js'
import Application from '../models/Application.js'

const RECOMMENDATION_LIMIT = 12

// Public/employee-safe view of a job — no fee, invoice, or internal sourcing data.
// Exported so other employee-facing controllers (saved jobs, recently viewed,
// recommendations) can shape their job payloads identically to the job board.
export function publicJob(job) {
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
    // Urgent-hiring roles can only be applied to with a premium account.
    instantHiring: !!job.instantHiring,
    postedOn: job.postedOn,
    posted: job.postedOn ? formatRelative(job.postedOn) : '',
  }
}

// `q` can match a company name, but company name lives on the Company doc,
// not Job — resolve the small set of matching company ids up front so
// buildJobQuery can stay a pure, DB-free function.
async function resolveMatchingCompanyIds(qTerms) {
  if (!qTerms?.length) return []
  const regex = new RegExp(qTerms.map(escapeRegex).join('|'), 'i')
  const companies = await Company.find({ name: regex }).select('_id').lean()
  return companies.map((c) => c._id)
}

export const listPublicJobs = asyncHandler(async (req, res) => {
  const filters = parseJobFilters(req.query)
  const matchingCompanyIdsForQ = await resolveMatchingCompanyIds(filters.q)
  const query = buildJobQuery(filters, { matchingCompanyIdsForQ })
  const { page, limit, skip } = paginationParams(req)

  if (filters.sort === 'nearest' && isValidCoord(filters.lat, filters.lng)) {
    const { jobs, total } = await nearbyJobsPage(Job, query, { lat: filters.lat, lng: filters.lng, page, limit })
    setPaginationHeaders(res, { page, limit, total })
    return res.json(jobs.map(publicJob))
  }

  if (filters.sort === 'relevance' && filters.q.length) {
    const titleRegex = new RegExp(filters.q.map(escapeRegex).join('|'), 'i')
    const [result] = await Job.aggregate([
      { $match: query },
      {
        $addFields: {
          _relevance: {
            $cond: [{ $regexMatch: { input: '$title', regex: titleRegex } }, 2, 1],
          },
        },
      },
      { $sort: { _relevance: -1, postedOn: -1 } },
      {
        $facet: {
          data: [{ $skip: skip }, { $limit: limit }],
          total: [{ $count: 'count' }],
        },
      },
    ])

    const jobs = result?.data ?? []
    const total = result?.total?.[0]?.count ?? 0
    await Job.populate(jobs, { path: 'company', select: 'name logo' })
    setPaginationHeaders(res, { page, limit, total })
    return res.json(jobs.map(publicJob))
  }

  const sort = buildSortStage(filters)
  const [jobs, total] = await Promise.all([
    Job.find(query).populate('company', 'name logo').sort(sort).skip(skip).limit(limit),
    Job.countDocuments(query),
  ])
  setPaginationHeaders(res, { page, limit, total })
  res.json(jobs.map(publicJob))
})

export const getPublicJob = asyncHandler(async (req, res) => {
  const job = await Job.findOne({ _id: req.params.id, ...publicJobFilter() }).populate(
    'company',
    'name logo'
  )
  if (!job) return res.status(404).json({ message: 'Job not found' })
  res.json(publicJob(job))
})

// Facet counts for the sidebar filters, scoped to candidate-visible jobs. Each
// group's counts are computed with every OTHER active filter applied but NOT its
// own — so on a multi-select group ("Remote" ticked) the sibling options still
// show how many jobs they would add, instead of collapsing to zero. Never touches
// fee/invoice/sourcing fields. Shared by the dashboard (/api/employee/jobs/facets)
// and the marketing site (/api/jobs/facets).
const FACET_RESET = {
  location: { location: [] },
  skills: { skills: [] },
  departments: { track: [] },
  workModes: { workMode: [] },
  employmentTypes: { employmentType: [] },
  companies: { companyIds: [] },
}

// "Lucknow", "lucknow " and "Lucknow, Uttar Pradesh" are one city — merge them
// (the location filter itself is a case-insensitive substring match, so picking
// the merged label still finds every spelling).
function mergeLocationRows(rows) {
  const byCity = new Map()
  for (const row of rows) {
    if (!row._id) continue
    const raw = String(row._id).split(',')[0].trim().replace(/\s+/g, ' ')
    const key = raw.toLowerCase()
    if (!key) continue
    const existing = byCity.get(key)
    if (existing) existing.count += row.count
    else byCity.set(key, { value: raw === raw.toLowerCase() || raw === raw.toUpperCase() ? raw.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : raw, count: row.count })
  }
  return [...byCity.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

export const getJobFacets = asyncHandler(async (req, res) => {
  const filters = parseJobFilters(req.query)
  const matchingCompanyIdsForQ = await resolveMatchingCompanyIds(filters.q)
  const queryFor = (override = {}) => buildJobQuery({ ...filters, ...override }, { matchingCompanyIdsForQ })

  const groupCount = (field, override) =>
    Job.aggregate([{ $match: queryFor(override) }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 200 }])
  const bucketCounts = (keys, group) =>
    Promise.all(keys.map(async (value) => ({ value, count: await Job.countDocuments(queryFor({ [group]: [value] })) })))

  const [locations, skills, departments, workModes, employmentTypes, companies, experience, salary, postedWithin] = await Promise.all([
    groupCount('location', FACET_RESET.location),
    Job.aggregate([
      { $match: queryFor(FACET_RESET.skills) },
      { $unwind: '$skills' },
      { $group: { _id: '$skills', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 60 },
    ]),
    groupCount('track', FACET_RESET.departments),
    groupCount('workMode', FACET_RESET.workModes),
    groupCount('employmentType', FACET_RESET.employmentTypes),
    Job.aggregate([
      { $match: queryFor(FACET_RESET.companies) },
      { $group: { _id: '$company', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
      { $lookup: { from: 'companies', localField: '_id', foreignField: '_id', as: 'company' } },
      { $unwind: '$company' },
      { $project: { _id: 0, id: '$_id', name: '$company.name', count: 1 } },
    ]),
    bucketCounts(Object.keys(EXPERIENCE_RANGES), 'experience'),
    bucketCounts(Object.keys(SALARY_RANGES), 'salary'),
    Promise.all(
      POSTED_WITHIN_DAYS.map(async (days) => ({
        value: String(days),
        count: await Job.countDocuments(queryFor({ postedWithinDays: days })),
      }))
    ),
  ])

  const asValueCount = (rows) => rows.filter((r) => r._id).map((r) => ({ value: r._id, count: r.count }))

  res.json({
    locations: mergeLocationRows(locations),
    skills: asValueCount(skills),
    departments: asValueCount(departments),
    workModes: asValueCount(workModes),
    employmentTypes: asValueCount(employmentTypes),
    companies,
    experience,
    salary,
    postedWithin,
  })
})

const groupValueCounts = (field) =>
  Job.aggregate([
    { $match: publicJobFilter() },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
  ]).then((rows) => rows.filter((r) => r._id).map((r) => ({ value: r._id, count: r.count })))

// Job-title and city/location autocomplete. Real counts always come from
// candidate-visible jobs only; the curated fallback (Backend/src/config/
// jobSuggestionsFallback.js) is only ever used to pad a sparse live list —
// see buildSuggestions — and is never a source of private data.
export const getJobSuggestions = asyncHandler(async (req, res) => {
  const type = req.query.type === 'location' ? 'location' : req.query.type === 'title' ? 'title' : null
  if (!type) return res.status(400).json({ message: 'type must be "title" or "location"' })

  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : ''
  const limit = Math.min(MAX_SUGGESTIONS, Math.max(1, Number.parseInt(req.query.limit, 10) || MAX_SUGGESTIONS))

  if (type === 'title') {
    const liveRows = await groupValueCounts('title')
    const items = buildSuggestions({ liveRows, curatedValues: POPULAR_JOB_TITLES, query, limit })
    return res.json({ type, query, items })
  }

  const [cityRows, remoteCount] = await Promise.all([
    groupValueCounts('location'),
    Job.countDocuments({
      ...publicJobFilter(),
      $or: [{ workMode: 'Remote' }, { location: /^remote$/i }],
    }),
  ])

  const remoteRelevant = matchRank('Remote', query) !== null
  const cityItems = buildSuggestions({ liveRows: cityRows, curatedValues: POPULAR_CITIES, query, limit: remoteRelevant ? limit - 1 : limit })
  const items = remoteRelevant ? [{ value: 'Remote', count: remoteCount, source: 'live', isRemote: true }, ...cityItems] : cityItems

  res.json({ type, query, items })
})

// "Jobs based on applies" — similar to what the candidate already applied
// to (same track or overlapping skills), excluding jobs already applied to.
export const getAppliedBasedJobs = asyncHandler(async (req, res) => {
  const employee = req.employee
  const applications = await Application.find({ employee: employee._id }).populate('job', 'track skills')
  const appliedJobIds = applications.map((a) => a.job?._id).filter(Boolean)

  if (!appliedJobIds.length) return res.json([])

  const tracks = [...new Set(applications.map((a) => a.job?.track).filter(Boolean))]
  const skills = [...new Set(applications.flatMap((a) => a.job?.skills ?? []))]

  if (!tracks.length && !skills.length) return res.json([])

  const or = []
  if (tracks.length) or.push({ track: { $in: tracks } })
  if (skills.length) or.push({ skills: { $in: skills.map((s) => new RegExp(`^${escapeRegex(s)}$`, 'i')) } })

  const query = { ...publicJobFilter(), _id: { $nin: appliedJobIds }, $or: or }
  const jobs = await Job.find(query).populate('company', 'name logo').sort({ postedOn: -1 }).limit(RECOMMENDATION_LIMIT)
  res.json(jobs.map(publicJob))
})

// "Urgent hiring" (stored as Job.instantHiring) — jobs Mzobs staff flagged as urgent-to-fill.
// Everyone can see them; applying to one needs a premium account (enforced in
// employeeApplicationController.applyToJob, and shown by the `instantHiring` flag below).
export const getInstantHiringJobs = asyncHandler(async (req, res) => {
  const jobs = await Job.find({ ...publicJobFilter(), instantHiring: true })
    .populate('company', 'name logo')
    .sort({ postedOn: -1 })
    .limit(RECOMMENDATION_LIMIT)
  res.json(jobs.map(publicJob))
})
