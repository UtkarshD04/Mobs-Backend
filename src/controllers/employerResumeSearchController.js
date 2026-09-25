import { asyncHandler } from '../utils/asyncHandler.js'
import { logActivity } from '../utils/activityLog.js'
import { initialsOf } from '../utils/initials.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import { parseResumeSearchFilters, buildResumeSearchQuery, baseResumeSearchFilter } from '../utils/resumeSearchFilters.js'
import { maskEmail, maskPhone } from './candidateController.js'
import Employee from '../models/Employee.js'
import Candidate from '../models/Candidate.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import ResumeAccessLog from '../models/ResumeAccessLog.js'
import { buildResumeAccessPath, buildLegacyResumeAccessPath } from '../utils/resumeAccess.js'
import { unlockCandidateForCredit, getWalletBalance, InsufficientCreditsError } from '../utils/creditWallet.js'
import { findOrCreateSourcedCandidate, JobNotFoundError } from '../utils/resdexSourcing.js'
import { REVEAL_PARTS, revealedParts, parseRevealField } from '../utils/candidateReveal.js'
import { logger } from '../config/logger.js'

// Resdex-style resume database search: every candidate account on the
// platform (not just this employer's own applicants — that's
// candidateController.js's job), searchable by skill/experience/location/
// notice period. Contact details stay masked until the employer spends a CV
// credit to unlock — same wallet, same CandidateUnlock rows, same masking
// as the Applicants list, so both surfaces share one "unlocked" concept per
// (company, candidate).
//
// Per-part reveals: one credit unlocks the candidate, but email, phone and
// resume are opened one at a time (`revealed`, a Set of 'email' | 'phone' |
// 'resume'; null = all three). Only a revealed part is ever sent.
export function redactEmployee(employee, { unlocked, candidateId, revealed = null }) {
  const parts = unlocked ? (revealed ?? new Set(REVEAL_PARTS)) : new Set()
  return {
    id: employee._id.toString(),
    employeeId: employee._id.toString(),
    candidateId,
    name: employee.name,
    initials: initialsOf(employee.name),
    headline: employee.resumeHeadline,
    experienceYears: employee.experienceYears,
    experience: employee.experience,
    currentCompany: employee.currentCompany,
    designation: employee.designation,
    location: employee.currentCity,
    state: employee.state,
    preferredLocations: employee.preferredLocations,
    relocationOk: !!employee.relocationOk,
    preferredRole: employee.preferredRole,
    currentCtc: employee.currentCtc,
    expectedSalary: employee.expectedSalaryMax ? `₹${employee.expectedSalaryMax}` : '',
    noticePeriod: employee.noticePeriod,
    skills: employee.skills,
    education: employee.education,
    projects: employee.projects,
    workHistory: employee.workHistory,
    portfolioLink: employee.portfolioLink,
    linkedin: employee.linkedin,
    github: employee.github,
    workModePreference: employee.workModePreference,
    jobTypePreference: employee.jobTypePreference,
    premium: !!employee.isPremium,
    resumeVerified: employee.resume?.status === 'verified',
    resumeUpdatedOn: employee.resume?.uploadedOn ?? null,
    lastActiveAt: employee.lastActiveAt,
    emailVerified: !!employee.emailVerified,
    phoneVerified: !!employee.phoneVerified,
    contactPreview: { email: maskEmail(employee.email), phone: maskPhone(employee.phone) },
    unlocked,
    revealed: [...parts],
    email: parts.has('email') ? employee.email : null,
    phone: parts.has('phone') ? employee.phone : null,
    resumeUrl: null,
  }
}

// Same short-lived signed link as candidateController's resolveCandidateResumeUrl;
// `employee` must have been loaded with `+resume.s3Key`. Null when there is no
// verified resume, so callers can say "not available" instead of 500ing.
function employeeResumeUrl(employee, purpose) {
  const resume = employee.resume
  if (!resume || resume.status !== 'verified') return null
  if (resume.s3Key) return buildResumeAccessPath(resume.s3Key, resume.file, purpose)
  return resume.url ? buildLegacyResumeAccessPath(resume.url, resume.file, purpose) : null
}

// GET /api/employer/resume-search — list/filter across the whole verified
// candidate pool. Pagination rides on headers (see paginate.js), same
// contract as every other list endpoint this dashboard already consumes.
export const searchResumeDatabase = asyncHandler(async (req, res) => {
  const filters = parseResumeSearchFilters(req.query)
  const query = buildResumeSearchQuery(filters)

  const { data, page, limit, total } = await paginate(Employee, query, paginationParams(req), {
    sort: { profileCompletedAt: -1, updatedAt: -1 },
  })
  setPaginationHeaders(res, { page, limit, total })

  const employeeIds = data.map((e) => e._id)
  const existing = await Candidate.find({ company: req.company._id, employee: { $in: employeeIds } }).select('employee')
  const candidateIdByEmployee = new Map(existing.map((c) => [c.employee.toString(), c._id.toString()]))

  const candidateIds = [...candidateIdByEmployee.values()]
  const unlocks = candidateIds.length
    ? await CandidateUnlock.find({ company: req.company._id, candidate: { $in: candidateIds } }).select('candidate revealed')
    : []
  const partsByCandidateId = new Map(unlocks.map((u) => [u.candidate.toString(), revealedParts(u)]))

  res.json(
    data.map((employee) => {
      const candidateId = candidateIdByEmployee.get(employee._id.toString()) ?? null
      const revealed = candidateId ? partsByCandidateId.get(candidateId) : undefined
      return redactEmployee(employee, { unlocked: !!revealed, candidateId, revealed })
    })
  )
})

// GET /api/employer/resume-search/:employeeId — single profile, same
// redaction rules as the list.
export const getResumeDatabaseCandidate = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ _id: req.params.employeeId, ...baseResumeSearchFilter() })
  if (!employee) return res.status(404).json({ message: 'Candidate not found' })

  const candidate = await Candidate.findOne({ company: req.company._id, employee: employee._id }).select('_id')
  const unlock = candidate ? await CandidateUnlock.findOne({ company: req.company._id, candidate: candidate._id }) : null

  res.json(redactEmployee(employee, { unlocked: !!unlock, candidateId: candidate?._id?.toString() ?? null, revealed: unlock ? revealedParts(unlock) : null }))
})

// POST /api/employer/resume-search/:employeeId/unlock — spends 1 CV credit
// to unlock this candidate's contact + resume for this employer, same as
// candidateController.unlockCandidate. A first-time unlock adds the employee
// to this company's Candidates (the Applicants pipeline's row); `jobId` is
// optional and, when given, files them under that job. Re-unlocking (or just
// viewing) an employee already sourced by this company reuses that same row
// and never charges twice.
export const unlockResumeDatabaseCandidate = asyncHandler(async (req, res) => {
  const reveal = parseRevealField(req.body?.field)
  if (!reveal) return res.status(400).json({ message: 'field must be one of: email, phone, resume' })

  const employee = await Employee.findOne({ _id: req.params.employeeId, ...baseResumeSearchFilter() }).select('+resume.s3Key')
  if (!employee) return res.status(404).json({ message: 'Candidate not found' })

  let candidate
  try {
    candidate = await findOrCreateSourcedCandidate({ companyId: req.company._id, employee, jobId: req.body?.jobId })
  } catch (err) {
    if (err instanceof JobNotFoundError) return res.status(404).json({ message: 'Job not found' })
    throw err
  }

  let result
  try {
    result = await unlockCandidateForCredit({
      companyId: req.company._id,
      candidateId: candidate._id,
      jobId: candidate.job,
      userId: req.user._id,
      reveal,
    })
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      logger.info({ companyId: req.company._id.toString(), employeeId: employee._id.toString() }, 'Resdex unlock failed — insufficient credits')
      return res.status(402).json({ code: 'INSUFFICIENT_CREDITS', message: 'You have no CV credits remaining. Buy more credits to unlock this candidate.' })
    }
    throw err
  }

  if (!result.alreadyUnlocked) {
    try {
      await logActivity(req.company._id, `Sourced and unlocked ${employee.name} via resume search (1 CV credit)`, 'gold')
    } catch (err) {
      logger.warn({ err }, 'Failed to log company activity for Resdex unlock')
    }
  }

  const wallet = await getWalletBalance(req.company._id)
  const parts = revealedParts(result.unlock)
  const json = redactEmployee(employee, { unlocked: true, candidateId: candidate._id.toString(), revealed: parts })
  json.resumeUrl = parts.has('resume') ? employeeResumeUrl(employee, 'employer-cv-credit-unlock') : null
  json.resumeFileName = json.resumeUrl ? employee.resume.file || '' : ''
  res.json({ candidate: json, wallet, alreadyUnlocked: result.alreadyUnlocked })
})

// GET /api/employer/resume-search/:employeeId/resume-url — a fresh signed
// link to the CV, only once this company has unlocked the candidate (the
// unlock is what the CV credit pays for). Every call is logged, same as
// candidateController.getCandidateResumeUrl.
export const getResumeDatabaseResumeUrl = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ _id: req.params.employeeId, ...baseResumeSearchFilter() }).select('+resume.s3Key')
  if (!employee) return res.status(404).json({ message: 'Candidate not found' })

  const candidate = await Candidate.findOne({ company: req.company._id, employee: employee._id }).select('_id application')
  const unlock = candidate ? await CandidateUnlock.findOne({ company: req.company._id, candidate: candidate._id }) : null
  // Paying for the candidate isn't enough on its own: the resume is one of the
  // parts the employer opens with its own click (see candidateReveal.js).
  if (!unlock || !revealedParts(unlock).has('resume')) {
    return res.status(403).json({ code: 'UNLOCK_REQUIRED', message: 'View this candidate\'s CV to open their resume.' })
  }

  const url = employeeResumeUrl(employee, 'employer-resume')
  if (!url) return res.status(404).json({ message: 'Resume not available for this candidate' })

  await ResumeAccessLog.create({
    company: req.company._id,
    candidate: candidate._id,
    employee: employee._id,
    application: candidate.application,
    action: 'resume_viewed',
    accessedBy: req.user._id,
  })

  res.json({ url, fileName: employee.resume.file || '' })
})
