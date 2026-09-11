// Pure, DB-free aggregation for the Landing Frontend's "Explore your next
// move" career discovery section (GET /api/jobs/category-highlights) —
// mirrors hotCities.js's pattern exactly: no DB access here, just a reducer
// over an already-fetched job list, so it's directly unit-testable and the
// controller stays a thin one-query wrapper.

// The curated set of categories this section highlights. `key` mirrors
// Job.track exactly for the six track-based categories; 'finance' has no
// track value (finance postings only ever land in the free-text
// `department` field, same rule getPublicCategoryCounts already applies),
// and 'freshers'/'remote' are filter-based virtual categories, not tracks.
export const CATEGORIES = [
  { key: 'tech', match: (j) => j.track === 'tech' },
  { key: 'sales', match: (j) => j.track === 'sales' },
  { key: 'marketing', match: (j) => j.track === 'marketing' },
  { key: 'design', match: (j) => j.track === 'design' },
  { key: 'finance', match: (j) => /finance|accounting/i.test(j.department ?? '') },
  { key: 'hr', match: (j) => j.track === 'hr' },
  { key: 'ops', match: (j) => j.track === 'ops' },
  { key: 'support', match: (j) => j.track === 'support' },
  { key: 'freshers', match: (j) => (j.experienceMin ?? 0) <= 1 },
  { key: 'remote', match: (j) => j.workMode === 'Remote' },
]

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

// Top N job titles by frequency among the given jobs — the real, live
// "popular roles" chips (each with its real opening count, for the chip's
// hover-reveal — never a fixed/guessed list or an invented count).
function topTitles(jobs, limit = 4) {
  const counts = new Map()
  for (const job of jobs) {
    const title = (job.title ?? '').trim()
    if (!title) continue
    counts.set(title, (counts.get(title) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([title, count]) => ({ title, count }))
}

function statsFor(jobs, now) {
  if (jobs.length === 0) {
    return { openings: 0, topRoles: [], salaryMin: null, salaryMax: null, verifiedEmployers: 0, newThisWeek: 0, workModes: [] }
  }

  const salaries = jobs.filter((j) => j.salaryMin && j.salaryMax)
  const verifiedCompanyIds = new Set(
    jobs.filter((j) => j.company?.verificationStatus === 'verified').map((j) => String(j.company._id ?? j.company))
  )
  const newThisWeek = jobs.filter((j) => {
    const postedOn = j.postedOn ?? j.createdAt
    return postedOn && now - new Date(postedOn).getTime() <= WEEK_MS
  }).length

  return {
    openings: jobs.length,
    topRoles: topTitles(jobs),
    salaryMin: salaries.length ? Math.min(...salaries.map((j) => j.salaryMin)) : null,
    salaryMax: salaries.length ? Math.max(...salaries.map((j) => j.salaryMax)) : null,
    verifiedEmployers: verifiedCompanyIds.size,
    newThisWeek,
    workModes: [...new Set(jobs.map((j) => j.workMode).filter(Boolean))],
  }
}

// `jobs` — already scoped to visibleToCandidates/public-status, each with
// title/track/department/experienceMin/workMode/salaryMin/salaryMax/
// postedOn/createdAt/company.verificationStatus (see the controller).
// Returns one bucket per curated category, real numbers only — a category
// with no matching jobs simply gets openings: 0, never a fabricated one.
export function aggregateCategoryHighlights(jobs, { now = Date.now() } = {}) {
  return CATEGORIES.map(({ key, match }) => ({ key, ...statsFor(jobs.filter(match), now) }))
}
