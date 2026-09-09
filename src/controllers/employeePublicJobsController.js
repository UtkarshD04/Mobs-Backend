import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import { paginationParams, setPaginationHeaders } from '../utils/paginate.js'
import { parseJobFilters, buildJobQuery, buildSortStage, escapeRegex, PUBLIC_STATUSES } from '../utils/jobQueryFilters.js'
import { matchRank, buildSuggestions, MAX_SUGGESTIONS } from '../utils/jobSuggestions.js'
import { POPULAR_JOB_TITLES, POPULAR_CITIES } from '../config/jobSuggestionsFallback.js'
import Job from '../models/Job.js'
import Company from '../models/Company.js'

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
  const job = await Job.findOne({ _id: req.params.id, visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } }).populate(
    'company',
    'name logo'
  )
  if (!job) return res.status(404).json({ message: 'Job not found' })
  res.json(publicJob(job))
})

// Facet counts for the sidebar filters, scoped to candidate-visible jobs and
// (optionally) narrowed by whatever filters are already active — so counts
// stay meaningful as the user filters further. Never touches fee/invoice/
// sourcing fields.
export const getJobFacets = asyncHandler(async (req, res) => {
  const filters = parseJobFilters(req.query)
  const matchingCompanyIdsForQ = await resolveMatchingCompanyIds(filters.q)
  const query = buildJobQuery(filters, { matchingCompanyIdsForQ })

  const groupCount = (field) => Job.aggregate([{ $match: query }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 50 }])

  const [locations, skills, departments, workModes, employmentTypes, companies] = await Promise.all([
    groupCount('location'),
    Job.aggregate([{ $match: query }, { $unwind: '$skills' }, { $group: { _id: '$skills', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 60 }]),
    groupCount('track'),
    groupCount('workMode'),
    groupCount('employmentType'),
    Job.aggregate([
      { $match: query },
      { $group: { _id: '$company', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
      { $lookup: { from: 'companies', localField: '_id', foreignField: '_id', as: 'company' } },
      { $unwind: '$company' },
      { $project: { _id: 0, id: '$_id', name: '$company.name', count: 1 } },
    ]),
  ])

  const asValueCount = (rows) => rows.filter((r) => r._id).map((r) => ({ value: r._id, count: r.count }))

  res.json({
    locations: asValueCount(locations),
    skills: asValueCount(skills),
    departments: asValueCount(departments),
    workModes: asValueCount(workModes),
    employmentTypes: asValueCount(employmentTypes),
    companies,
  })
})

const groupValueCounts = (field) =>
  Job.aggregate([
    { $match: { visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } } },
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
      visibleToCandidates: true,
      status: { $in: PUBLIC_STATUSES },
      $or: [{ workMode: 'Remote' }, { location: /^remote$/i }],
    }),
  ])

  const remoteRelevant = matchRank('Remote', query) !== null
  const cityItems = buildSuggestions({ liveRows: cityRows, curatedValues: POPULAR_CITIES, query, limit: remoteRelevant ? limit - 1 : limit })
  const items = remoteRelevant ? [{ value: 'Remote', count: remoteCount, source: 'live', isRemote: true }, ...cityItems] : cityItems

  res.json({ type, query, items })
})
