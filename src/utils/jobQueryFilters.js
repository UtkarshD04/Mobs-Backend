// Pure query-building helpers for the employee-facing job board
// (GET /api/employee/jobs, GET /api/employee/jobs/facets). Kept free of any
// DB access so the parsing/allowlisting/overlap logic can be unit tested
// directly — see jobQueryFilters.test.js.

export const WORK_MODES = ['On-site', 'Hybrid', 'Remote']
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship']
export const TRACKS = ['analytics', 'design', 'sales', 'marketing', 'hr', 'support', 'tech', 'ops']
export const PUBLIC_STATUSES = ['sourcing', 'delivered']

// '0-1' is kept (rather than a plain '0') for compatibility with the
// existing Landing Frontend "Freshers" link (?experience=0-1).
export const EXPERIENCE_RANGES = {
  '0-1': { min: 0, max: 1 },
  '1-3': { min: 1, max: 3 },
  '3-5': { min: 3, max: 5 },
  '5-10': { min: 5, max: 10 },
  '10+': { min: 10, max: Infinity },
}

// Values are annual CTC in rupees.
export const SALARY_RANGES = {
  '0-3': { min: 0, max: 300000 },
  '3-6': { min: 300000, max: 600000 },
  '6-10': { min: 600000, max: 1000000 },
  '10-15': { min: 1000000, max: 1500000 },
  '15+': { min: 1500000, max: Infinity },
}

export const POSTED_WITHIN_DAYS = [1, 3, 7, 30]
export const SORT_OPTIONS = ['newest', 'salary_desc', 'salary_asc', 'relevance']
// Caps how many comma-separated q/location terms one request can carry (a
// multi-tag search box on the frontend) — keeps the alternation regex built
// in buildJobQuery small and bounded regardless of what a client sends.
export const MAX_QUERY_TERMS = 10

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/

export function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseCsv(value) {
  if (value == null || value === '') return []
  const raw = Array.isArray(value) ? value : String(value).split(',')
  return [...new Set(raw.map((v) => String(v).trim()).filter(Boolean))]
}

function allowlisted(values, allowed) {
  const allowedSet = new Set(allowed)
  return values.filter((v) => allowedSet.has(v))
}

// Turns raw, untrusted req.query into a normalized, allowlisted filter
// object. Nothing here is ever interpolated as a Mongo operator key, so
// arbitrary `$where`/`$gt`-style query-string payloads have no effect.
//
// `q` and `location` are each a *list* of terms (comma-separated in the
// query string, e.g. `q=Frontend Developer,React`) — a multi-tag search box
// can hold several job titles/skills/companies or several cities/"Remote"
// at once, and buildJobQuery matches a job against any one of them (OR). A
// single term with no comma parses to a one-element array, so existing
// single-value callers see identical matching behavior.
export function parseJobFilters(query = {}) {
  const q = parseCsv(query.q ?? query.search)
    .map((s) => s.slice(0, 100))
    .slice(0, MAX_QUERY_TERMS)
  const location = parseCsv(query.location)
    .map((s) => s.slice(0, 100))
    .slice(0, MAX_QUERY_TERMS)

  return {
    q,
    location,
    workMode: allowlisted(parseCsv(query.workMode), WORK_MODES),
    employmentType: allowlisted(parseCsv(query.employmentType), EMPLOYMENT_TYPES),
    track: allowlisted(parseCsv(query.track ?? query.department), TRACKS),
    experience: allowlisted(parseCsv(query.experience), Object.keys(EXPERIENCE_RANGES)),
    salary: allowlisted(parseCsv(query.salary), Object.keys(SALARY_RANGES)),
    skills: parseCsv(query.skills).slice(0, 20).map((s) => s.slice(0, 60)),
    postedWithinDays: POSTED_WITHIN_DAYS.includes(Number(query.postedWithin)) ? Number(query.postedWithin) : null,
    companyIds: parseCsv(query.company).filter((id) => OBJECT_ID_RE.test(id)),
    ids: parseCsv(query.ids).filter((id) => OBJECT_ID_RE.test(id)),
    sort: SORT_OPTIONS.includes(query.sort) ? query.sort : 'newest',
  }
}

// { $or: [...] } clause matching a job whose [experienceMin, experienceMax]
// overlaps any of the selected ranges, e.g. a 2–4yr job matches "1-3".
export function experienceOverlapQuery(rangeKeys) {
  const ranges = rangeKeys.map((k) => EXPERIENCE_RANGES[k]).filter(Boolean)
  if (!ranges.length) return null
  return {
    $or: ranges.map(({ min, max }) => {
      const cond = { experienceMax: { $gte: min } }
      if (Number.isFinite(max)) cond.experienceMin = { $lte: max }
      return cond
    }),
  }
}

// Same overlap logic for annual CTC ranges.
export function salaryOverlapQuery(rangeKeys) {
  const ranges = rangeKeys.map((k) => SALARY_RANGES[k]).filter(Boolean)
  if (!ranges.length) return null
  return {
    $or: ranges.map(({ min, max }) => {
      const cond = { salaryMax: { $gte: min } }
      if (Number.isFinite(max)) cond.salaryMin = { $lte: max }
      return cond
    }),
  }
}

export function postedWithinQuery(days) {
  if (!days) return null
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  return { postedOn: { $gte: since } }
}

// Builds the final Mongo filter. `matchingCompanyIdsForQ` is resolved by the
// caller (a small Company.find({name: regex}) lookup) since this module
// stays DB-free; passing an empty array simply skips that OR-branch.
export function buildJobQuery(filters, { matchingCompanyIdsForQ = [] } = {}) {
  const query = { visibleToCandidates: true, status: { $in: PUBLIC_STATUSES } }
  const and = []

  if (filters.ids.length) query._id = { $in: filters.ids }
  if (filters.track.length) query.track = { $in: filters.track }
  if (filters.workMode.length) query.workMode = { $in: filters.workMode }
  if (filters.employmentType.length) query.employmentType = { $in: filters.employmentType }
  if (filters.companyIds.length) query.company = { $in: filters.companyIds }

  if (filters.skills.length) {
    query.skills = { $in: filters.skills.map((s) => new RegExp(`^${escapeRegex(s)}$`, 'i')) }
  }

  const experienceQuery = experienceOverlapQuery(filters.experience)
  if (experienceQuery) and.push(experienceQuery)

  const salaryQuery = salaryOverlapQuery(filters.salary)
  if (salaryQuery) and.push(salaryQuery)

  const postedQuery = postedWithinQuery(filters.postedWithinDays)
  if (postedQuery) Object.assign(query, postedQuery)

  if (filters.q.length) {
    // One alternation regex ("term1|term2|...") rather than one clause per
    // term — a job matches this $or if ANY selected term appears in ANY of
    // these fields, which is exactly "OR across tags" without the $or list
    // growing per term.
    const regex = new RegExp(filters.q.map(escapeRegex).join('|'), 'i')
    const or = [{ title: regex }, { skills: regex }, { department: regex }, { location: regex }]
    if (matchingCompanyIdsForQ.length) or.push({ company: { $in: matchingCompanyIdsForQ } })
    and.push({ $or: or })
  }

  if (filters.location.length) {
    const regex = new RegExp(filters.location.map(escapeRegex).join('|'), 'i')
    const or = [{ location: regex }]
    // The Landing Frontend's "Remote Jobs" card (and a "Remote" location tag
    // from the multi-select search box) sends "Remote" even though that
    // describes workMode, not the location string — match either, for every
    // selected term that happens to name a work mode.
    const workModeMatches = [...new Set(filters.location.map((loc) => WORK_MODES.find((w) => w.toLowerCase() === loc.toLowerCase())).filter(Boolean))]
    if (workModeMatches.length) or.push({ workMode: { $in: workModeMatches } })
    and.push({ $or: or })
  }

  if (and.length) query.$and = and
  return query
}

export function buildSortStage(filters) {
  switch (filters.sort) {
    case 'salary_desc':
      return { salaryMax: -1, postedOn: -1 }
    case 'salary_asc':
      return { salaryMin: 1, postedOn: -1 }
    default:
      return { postedOn: -1 }
  }
}
