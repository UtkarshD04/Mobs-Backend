// Pure, DB-free aggregation for the Landing Frontend's "Companies Hiring
// Through MZOBS" section (GET /api/jobs/hiring-companies) — mirrors
// hotCities.js / categoryHighlights.js's pattern exactly: no DB access
// here, just a reducer over an already-fetched job list, so it's directly
// unit-testable and the controller stays a thin one-query wrapper.

// Same real-category derivation categoryHighlights.js/hotCities.js already
// use elsewhere on this site — 'finance' has no Job.track value of its own
// (finance postings only ever land in the free-text `department` field), so
// it's matched there instead, exactly like every other real "Finance" tile
// on this site. There's no honest way to derive a "Healthcare" category
// from the current data model, so it's not offered here.
export const HIRING_CATEGORIES = [
  { key: 'tech', label: 'Technology', match: (j) => j.track === 'tech' },
  { key: 'sales', label: 'Sales', match: (j) => j.track === 'sales' },
  { key: 'marketing', label: 'Marketing', match: (j) => j.track === 'marketing' },
  { key: 'finance', label: 'Finance', match: (j) => /finance|accounting/i.test(j.department ?? '') },
  { key: 'design', label: 'Design', match: (j) => j.track === 'design' },
  { key: 'hr', label: 'HR', match: (j) => j.track === 'hr' },
  { key: 'ops', label: 'Operations', match: (j) => j.track === 'ops' },
]

function categoryKeysFor(jobs) {
  return HIRING_CATEGORIES.filter((c) => jobs.some((j) => c.match(j))).map((c) => c.key)
}

// `jobs` — already scoped to visibleToCandidates/public-status, each with
// location/track/department/workMode and a populated `company`
// (name/logo/website/verificationStatus/blocked — see the controller).
// Groups by company and returns one entry per company that has at least
// one such job right now — a company with zero live jobs simply never
// appears here at all, never a fabricated "0 open roles" placeholder.
// Sorted by activeJobs desc so the busiest hirers lead the wall.
export function aggregateHiringCompanies(jobs) {
  const byCompany = new Map()
  for (const job of jobs) {
    const company = job.company
    if (!company || company.blocked) continue
    const id = String(company._id ?? company.id ?? company)
    if (!byCompany.has(id)) byCompany.set(id, { company, jobs: [] })
    byCompany.get(id).jobs.push(job)
  }

  return [...byCompany.values()]
    .map(({ company, jobs: companyJobs }) => ({
      id: String(company._id ?? company.id),
      name: company.name,
      logo: company.logo || '',
      website: company.website || '',
      verified: company.verificationStatus === 'verified',
      activeJobs: companyJobs.length,
      categories: categoryKeysFor(companyJobs),
      locations: [...new Set(companyJobs.map((j) => (j.location ?? '').trim()).filter(Boolean))].slice(0, 4),
      // Real, distinct Job.workMode values across this company's live jobs
      // ('On-site' | 'Hybrid' | 'Remote') — lets the UI show "Remote" or
      // "Hybrid" or both, rather than collapsing everything to one boolean.
      workModes: [...new Set(companyJobs.map((j) => j.workMode).filter(Boolean))],
      remoteAvailable: companyJobs.some((j) => j.workMode === 'Remote'),
      // Every company this function returns has ≥1 real live job by
      // construction (that's what put it in `byCompany` at all), so this is
      // never a separate, independently-fakeable flag — just a readable
      // label for the same fact `activeJobs > 0` already guarantees.
      hiringStatus: 'active',
    }))
    .sort((a, b) => b.activeJobs - a.activeJobs)
}
