// Pure query-building helpers for the employer-facing resume database
// search (Resdex-style candidate sourcing — GET /api/employer/resume-search).
// Kept free of any DB access, same split as jobQueryFilters.js.
import { escapeRegex, parseCsv, WORK_MODES, EMPLOYMENT_TYPES } from './jobQueryFilters.js'

const MAX_EXPERIENCE_YEARS = 40
const MAX_QUERY_TERMS = 10

function parseExperienceYears(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= MAX_EXPERIENCE_YEARS ? n : null
}

function allowlisted(values, allowed) {
  const allowedSet = new Set(allowed)
  return values.filter((v) => allowedSet.has(v))
}

// Turns raw, untrusted req.query into a normalized, allowlisted filter
// object — same "never interpolate as a Mongo operator key" guarantee as
// parseJobFilters.
export function parseResumeSearchFilters(query = {}) {
  return {
    q: parseCsv(query.q ?? query.search)
      .map((s) => s.slice(0, 100))
      .slice(0, MAX_QUERY_TERMS),
    location: parseCsv(query.location)
      .map((s) => s.slice(0, 100))
      .slice(0, MAX_QUERY_TERMS),
    skills: parseCsv(query.skills).slice(0, 20).map((s) => s.slice(0, 60)),
    experienceMin: parseExperienceYears(query.experienceMin),
    experienceMax: parseExperienceYears(query.experienceMax),
    workMode: allowlisted(parseCsv(query.workMode), WORK_MODES),
    jobType: allowlisted(parseCsv(query.jobType), EMPLOYMENT_TYPES),
    noticePeriod: query.noticePeriod ? String(query.noticePeriod).slice(0, 60) : null,
  }
}

// The one definition of "a profile visible in the resume database": an
// active account, open to opportunities, with a verified resume — same
// quality bar the employer-facing "Applicants" list implies via
// resumeVerified, just enforced at the source instead of a snapshot flag.
export function baseResumeSearchFilter() {
  return { status: 'active', openToOpportunities: true, 'resume.status': 'verified' }
}

export function buildResumeSearchQuery(filters) {
  const query = baseResumeSearchFilter()
  const and = []

  if (filters.skills.length) {
    query.skills = { $in: filters.skills.map((s) => new RegExp(`^${escapeRegex(s)}$`, 'i')) }
  }

  if (filters.experienceMin != null || filters.experienceMax != null) {
    query.experienceYears = {}
    if (filters.experienceMin != null) query.experienceYears.$gte = filters.experienceMin
    if (filters.experienceMax != null) query.experienceYears.$lte = filters.experienceMax
  }

  if (filters.workMode.length) query.workModePreference = { $in: filters.workMode }
  if (filters.jobType.length) query.jobTypePreference = { $in: filters.jobType }
  if (filters.noticePeriod) query.noticePeriod = filters.noticePeriod

  if (filters.location.length) {
    and.push({ currentCity: new RegExp(filters.location.map(escapeRegex).join('|'), 'i') })
  }

  if (filters.q.length) {
    // One alternation regex across every term, matched against every
    // searchable field — "OR across tags", same idiom as buildJobQuery.
    const regex = new RegExp(filters.q.map(escapeRegex).join('|'), 'i')
    and.push({ $or: [{ name: regex }, { resumeHeadline: regex }, { skills: regex }, { preferredRole: regex }, { designation: regex }, { currentCompany: regex }] })
  }

  if (and.length) query.$and = and
  return query
}
