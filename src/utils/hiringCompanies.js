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

  return [...byCompany.values()].map(({ company, jobs: companyJobs }) => toCompanyEntry(company, companyJobs)).sort(byActiveJobsThenName)
}

function toCompanyEntry(company, companyJobs) {
  return {
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
    // `activeJobs > 0` for a company with live openings right now; a
    // company with none is still a real, onboarded employer, just not
    // currently hiring — see aggregateAllCompanies below.
    hiringStatus: companyJobs.length > 0 ? 'active' : 'onboarded',
  }
}

function byActiveJobsThenName(a, b) {
  return b.activeJobs - a.activeJobs || a.name.localeCompare(b.name)
}

// `companies` — every non-blocked Company doc (id/name/logo/website/
// verificationStatus), fetched independently of any job. `jobs` — the same
// public/live job list aggregateHiringCompanies uses. Returns one entry per
// onboarded company, whether or not it currently has a live job — the
// "Companies Hiring on Mzobs" wall's marquee shows every real company that's
// ever joined the platform, not just the ones hiring this instant. A company
// with no live jobs gets activeJobs: 0 and hiringStatus: 'onboarded' rather
// than being dropped, same real-data-only rule as everywhere else in this
// file — nothing here is a fabricated/curated name.
export function aggregateAllCompanies(companies, jobs) {
  const jobsByCompany = new Map()
  for (const job of jobs) {
    const company = job.company
    if (!company) continue
    const id = String(company._id ?? company.id ?? company)
    if (!jobsByCompany.has(id)) jobsByCompany.set(id, [])
    jobsByCompany.get(id).push(job)
  }

  return companies
    .filter((company) => !company.blocked)
    .map((company) => toCompanyEntry(company, jobsByCompany.get(String(company._id ?? company.id)) ?? []))
    .sort(byActiveJobsThenName)
}
