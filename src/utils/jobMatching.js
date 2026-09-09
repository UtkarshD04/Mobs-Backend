// Pure, DB-free job/candidate match scoring — mirrors jobQueryFilters.js's
// pattern of keeping the actual matching logic testable without a database.
// Used by employeeRecommendationsController to power "Jobs matching your
// profile" with a transparent, rule-based (never fabricated) explanation.

const WEIGHTS = { skills: 30, role: 15, location: 15, workMode: 10, jobType: 10, experience: 10, category: 10 }

function norm(s) {
  return String(s ?? '').trim().toLowerCase()
}

function matchedSkills(employeeSkills = [], jobSkills = []) {
  const set = new Set(employeeSkills.map(norm).filter(Boolean))
  return jobSkills.filter((s) => set.has(norm(s)))
}

// A loose "does the job title relate to what the candidate wants" check —
// word-overlap rather than exact match, since "Business Analyst" should
// still surface "Senior Business Analyst".
function roleMatches(preferredRole, jobTitle) {
  const role = norm(preferredRole)
  if (!role) return false
  const title = norm(jobTitle)
  if (title.includes(role) || role.includes(title)) return true
  const roleWords = role.split(/\s+/).filter((w) => w.length > 2)
  const titleWords = new Set(title.split(/\s+/).filter((w) => w.length > 2))
  return roleWords.some((w) => titleWords.has(w))
}

function locationMatches(preferredLocations = [], jobLocation) {
  const loc = norm(jobLocation)
  if (!loc) return false
  return preferredLocations.some((p) => {
    const pn = norm(p)
    return pn && (loc.includes(pn) || pn.includes(loc))
  })
}

function experienceOverlaps(experienceYears, job) {
  if (experienceYears == null) return false
  const min = job.experienceMin ?? 0
  const max = job.experienceMax ?? Infinity
  return experienceYears >= min - 0.5 && experienceYears <= max + 0.5
}

function categoryMatches(skillTrackKey, jobTrack) {
  return !!skillTrackKey && !!jobTrack && norm(skillTrackKey) === norm(jobTrack)
}

// e.g. "analytics" -> "Analytics" — a readable fallback for when the
// candidate's skillTrack has no human-authored `label` yet.
function titleCase(key) {
  return String(key ?? '').replace(/(^|\s)\w/g, (c) => c.toUpperCase())
}

// Scores one job against one candidate profile. Returns a 0-100 `score` and
// a list of short, factual `reasons` — never a made-up "95% match", only
// statements the caller can point back to a specific profile field for.
export function scoreJobForEmployee(employee, job) {
  let score = 0
  const reasons = []

  const skills = matchedSkills(employee.skills, job.skills)
  if (skills.length) {
    const ratio = job.skills?.length ? skills.length / job.skills.length : 1
    score += Math.round(WEIGHTS.skills * Math.min(1, ratio + skills.length * 0.1))
    reasons.push(`Matches your ${skills.slice(0, 3).join(', ')} skill${skills.length > 1 ? 's' : ''}`)
  }

  if (roleMatches(employee.preferredRole, job.title)) {
    score += WEIGHTS.role
    reasons.push(`Matches your preferred role: ${employee.preferredRole}`)
  }

  if (locationMatches(employee.preferredLocations, job.location)) {
    score += WEIGHTS.location
    reasons.push(`In your preferred location: ${job.location}`)
  }

  if (employee.workModePreference?.length && job.workMode && employee.workModePreference.includes(job.workMode)) {
    score += WEIGHTS.workMode
    reasons.push(`Matches your ${job.workMode} work-mode preference`)
  }

  if (employee.jobTypePreference?.length && job.employmentType && employee.jobTypePreference.includes(job.employmentType)) {
    score += WEIGHTS.jobType
    reasons.push(`Matches your ${job.employmentType} preference`)
  }

  if (experienceOverlaps(employee.experienceYears, job)) {
    score += WEIGHTS.experience
    reasons.push('Fits your experience level')
  }

  if (categoryMatches(employee.skillTrack?.key, job.track)) {
    score += WEIGHTS.category
    reasons.push(`In your ${employee.skillTrack.label || titleCase(employee.skillTrack.key)} track`)
  }

  return { score: Math.min(100, score), reasons }
}

// Ranks + filters a job list for a candidate: scores everything, drops
// zero-reason jobs (nothing to transparently explain = not a recommendation),
// sorts by score desc (ties broken by postedOn desc, already the input order
// from the caller's DB query), and caps to `limit`.
export function rankJobsForEmployee(employee, jobs, { limit = 20 } = {}) {
  return jobs
    .map((job) => ({ job, ...scoreJobForEmployee(employee, job) }))
    .filter((r) => r.reasons.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
