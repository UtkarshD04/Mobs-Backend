// The recruiter pipeline's seven columns, and how they map onto Candidate.stage.
//
// 'New' and 'Reviewed' are both Candidate.stage 'shared'; Candidate.reviewedAt tells them apart. That keeps every other
// consumer of `stage` (application sync, staff tools, the mobile apps) exactly as it was.

export const PIPELINE_STAGES = ['new', 'reviewed', 'shortlisted', 'interview', 'offer', 'hired', 'rejected']

export const STAGE_LABELS = { new: 'New', reviewed: 'Reviewed', shortlisted: 'Shortlisted', interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected' }

const DB_STAGE = { new: 'shared', reviewed: 'shared', shortlisted: 'shortlisted', interview: 'interviewing', offer: 'offered', hired: 'hired', rejected: 'rejected' }

export const dbStageFor = (key) => DB_STAGE[key] ?? null

export function pipelineStageOf(candidate) {
  switch (candidate.stage) {
    case 'shared':
      return candidate.reviewedAt ? 'reviewed' : 'new'
    case 'shortlisted':
      return 'shortlisted'
    case 'interviewing':
      return 'interview'
    case 'offered':
      return 'offer'
    case 'hired':
      return 'hired'
    case 'rejected':
      return 'rejected'
    default:
      return 'new'
  }
}

// Mongo filter for one pipeline column.
export function stageFilter(key) {
  if (key === 'new') return { stage: 'shared', reviewedAt: null }
  if (key === 'reviewed') return { stage: 'shared', reviewedAt: { $ne: null } }
  const db = DB_STAGE[key]
  return db ? { stage: db } : null
}

const firstNumber = (s) => {
  const m = String(s ?? '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) : null
}

/** "₹500000" -> 5, "12 LPA" -> 12, "" -> null. Salaries are stored as annual rupees or lakhs depending on the source. */
export function toLpa(s) {
  const n = typeof s === 'number' ? s : firstNumber(s)
  if (n == null) return null
  return n >= 1000 ? Math.round((n / 100000) * 10) / 10 : n
}

/** "Immediate" -> 0, "15 days" -> 15, "2 months" -> 60, "" -> null (unknown, never guessed). */
export function toNoticeDays(s) {
  const t = String(s ?? '').toLowerCase()
  if (!t.trim()) return null
  if (/immediate|now|none/.test(t)) return 0
  const n = firstNumber(t)
  if (n == null) return null
  if (/month/.test(t)) return n * 30
  if (/week/.test(t)) return n * 7
  return n
}

const lower = (s) => String(s ?? '').trim().toLowerCase()

// How a candidate lines up with the job's stated requirements. Facts only: skills named on both sides, whether the
// experience falls inside the range the job asks for, whether the stated city appears in the candidate's location, and
// whether their expected salary is within the job's budget. No scores.
export function requirementMatch(candidate, job) {
  if (!job) return null
  const have = new Set((candidate.skills ?? []).map(lower))
  const required = (job.skills ?? []).filter(Boolean)
  const matchedSkills = required.filter((s) => have.has(lower(s)))
  const missingSkills = required.filter((s) => !have.has(lower(s)))

  const years = candidate.experienceYears ?? 0
  let experience = null
  if (Number.isFinite(job.experienceMin) && Number.isFinite(job.experienceMax)) {
    experience = years < job.experienceMin ? 'below' : years > job.experienceMax ? 'above' : 'within'
  }

  const city = lower(String(job.location ?? '').split(',')[0])
  const location = city && candidate.location ? lower(candidate.location).includes(city) : null

  const expected = toLpa(candidate.expectedSalary)
  const maxLpa = job.salaryMax ? job.salaryMax / 100000 : null
  const salary = expected != null && maxLpa ? (expected <= maxLpa ? 'within' : 'above') : null

  return { matchedSkills, missingSkills, requiredSkills: required.length, experience, location, salary }
}

// Short, factual chips for the card: only what is actually true of this candidate.
export function matchHighlights(candidate, job) {
  const m = requirementMatch(candidate, job)
  if (!m) return []
  const out = []
  if (m.requiredSkills) out.push({ ok: m.matchedSkills.length > 0, label: `${m.matchedSkills.length}/${m.requiredSkills} skills`, detail: m.matchedSkills.length ? `Matches: ${m.matchedSkills.join(', ')}` : 'None of the listed skills found on the profile' })
  if (m.experience) out.push({ ok: m.experience === 'within', label: m.experience === 'within' ? 'Experience fits' : m.experience === 'below' ? 'Below experience range' : 'Above experience range', detail: `Job asks ${job.experienceMin}–${job.experienceMax} yrs; profile has ${candidate.experienceYears ?? 0}` })
  if (m.location === true) out.push({ ok: true, label: 'Location match', detail: `${candidate.location}` })
  if (m.salary) out.push({ ok: m.salary === 'within', label: m.salary === 'within' ? 'Within budget' : 'Above budget', detail: `Expects ${candidate.expectedSalary}` })
  return out
}

export function averageRating(ratings) {
  const values = Object.values(ratings ?? {}).filter((v) => Number.isFinite(v))
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null
}
