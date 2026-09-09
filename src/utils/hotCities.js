// Pure, DB-free aggregation for the Landing Frontend's "Hot Jobs by City"
// section (GET /api/jobs/hot-cities) — mirrors jobMatching.js's pattern from
// the candidate-recommendation work: no DB access here, just a reducer over
// an already-fetched job list, so it's directly unit-testable (see
// hotCities.test.js) and the controller stays a thin one-query wrapper.

// The curated set of cities this section highlights — matched against the
// free-text Job.location field the same way buildJobQuery's own location
// clause already does (a simple case-insensitive substring test, not
// canonicalized city data). Kept separate from config/jobSuggestionsFallback.js's
// POPULAR_CITIES: that list pads autocomplete suggestions, a different
// concern from "which cities does the homepage spotlight."
export const HOT_CITIES = [
  { city: 'Bengaluru', slug: 'bengaluru', match: /bengaluru|bangalore/i },
  { city: 'Mumbai', slug: 'mumbai', match: /mumbai/i },
  { city: 'Delhi NCR', slug: 'delhi-ncr', match: /delhi/i },
  { city: 'Hyderabad', slug: 'hyderabad', match: /hyderabad/i },
  { city: 'Pune', slug: 'pune', match: /pune/i },
  { city: 'Chennai', slug: 'chennai', match: /chennai/i },
  { city: 'Noida', slug: 'noida', match: /noida/i },
  { city: 'Gurugram', slug: 'gurugram', match: /gurugram|gurgaon/i },
  { city: 'Kolkata', slug: 'kolkata', match: /kolkata|calcutta/i },
  { city: 'Lucknow', slug: 'lucknow', match: /lucknow/i },
  { city: 'Ahmedabad', slug: 'ahmedabad', match: /ahmedabad/i },
  { city: 'Jaipur', slug: 'jaipur', match: /jaipur/i },
  { city: 'Chandigarh', slug: 'chandigarh', match: /chandigarh|mohali|panchkula/i },
  { city: 'Indore', slug: 'indore', match: /indore/i },
  { city: 'Kochi', slug: 'kochi', match: /kochi|cochin/i },
  { city: 'Bhopal', slug: 'bhopal', match: /bhopal/i },
]

// Category filters offered alongside "All Jobs" — `trackKeys` map to
// Job.track values; 'finance' has none (finance postings only ever land in
// the free-text `department` field — same rule getPublicCategoryCounts
// already applies to its Finance tile), matched by `departmentMatch` instead.
export const CATEGORY_FILTERS = [
  { key: 'all', label: 'All Jobs' },
  { key: 'tech', label: 'IT & Tech', trackKeys: ['tech'] },
  { key: 'sales', label: 'Sales', trackKeys: ['sales'] },
  { key: 'finance', label: 'Finance', departmentMatch: /finance|accounting/i },
  { key: 'marketing', label: 'Marketing', trackKeys: ['marketing'] },
  { key: 'ops', label: 'Operations', trackKeys: ['ops'] },
]

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function jobMatchesFilter(job, filter) {
  if (filter.key === 'all') return true
  if (filter.trackKeys) return filter.trackKeys.includes(job.track)
  if (filter.departmentMatch) return filter.departmentMatch.test(job.department ?? '')
  return false
}

// Top N department values by frequency among the given jobs — the real,
// live "top categories" chips, never a fixed/guessed label.
function topDepartments(jobs, limit = 3) {
  const counts = new Map()
  for (const job of jobs) {
    const dept = (job.department ?? '').trim()
    if (!dept) continue
    counts.set(dept, (counts.get(dept) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([dept]) => dept)
}

function bucketStats(jobs, now = Date.now()) {
  if (jobs.length === 0) {
    return { openings: 0, topCategories: [], salaryMin: null, salaryMax: null, verifiedEmployers: 0, newThisWeek: 0 }
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
    topCategories: topDepartments(jobs),
    salaryMin: salaries.length ? Math.min(...salaries.map((j) => j.salaryMin)) : null,
    salaryMax: salaries.length ? Math.max(...salaries.map((j) => j.salaryMax)) : null,
    verifiedEmployers: verifiedCompanyIds.size,
    newThisWeek,
  }
}

// `jobs` — already scoped to visibleToCandidates/public-status, city-matching
// jobs (see the controller), each with location/track/department/salaryMin/
// salaryMax/postedOn/createdAt/company.verificationStatus. Returns one
// bucket per city × filter combination, real numbers only — a city with no
// matching jobs for a filter simply gets openings: 0, never a fabricated one.
export function aggregateHotCities(jobs, { now = Date.now() } = {}) {
  return HOT_CITIES.map(({ city, slug, match }) => {
    const cityJobs = jobs.filter((j) => match.test(j.location ?? ''))
    const byFilter = {}
    for (const filter of CATEGORY_FILTERS) {
      byFilter[filter.key] = bucketStats(cityJobs.filter((j) => jobMatchesFilter(j, filter)), now)
    }
    return { city, slug, byFilter }
  })
}
