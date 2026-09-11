import { asyncHandler } from '../utils/asyncHandler.js'
import { logActivity } from '../utils/activityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Candidate from '../models/Candidate.js'
import Batch from '../models/Batch.js'
import Employee from '../models/Employee.js'
import ResumeAccessLog from '../models/ResumeAccessLog.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import { buildResumeAccessPath } from '../utils/resumeAccess.js'
import { hasActiveEmployerSubscription } from '../utils/employerSubscriptionAccess.js'
import { unlockCandidateForCredit, getWalletBalance, InsufficientCreditsError } from '../utils/creditWallet.js'
import { logger } from '../config/logger.js'

// A user@example.com -> u***@example.com style mask — enough to show the
// applicant has a real, reachable email/phone without revealing it before
// the employer has actually paid a credit to unlock it.
// Exported for direct unit testing (see candidateRedaction.test.js).
export function maskEmail(email) {
  if (!email) return null
  const [user, domain] = email.split('@')
  if (!domain) return null
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(user.length - 1, 3))}@${domain}`
}

export function maskPhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return '*'.repeat(digits.length)
  return `${'*'.repeat(digits.length - 4)}${digits.slice(-4)}`
}

// Resume, email and phone are private candidate data — they are stripped
// from every list/detail response unless this specific employer has spent a
// CV credit to unlock this specific candidate (`unlocked`). This keeps a
// bulk `GET /candidates` call from ever leaking private data for a
// candidate nobody has paid to unlock, credit balance or not.
// Exported for direct unit testing (see candidateRedaction.test.js).
export function redactCandidate(candidate, unlocked) {
  const json = typeof candidate.toJSON === 'function' ? candidate.toJSON() : candidate
  const rawEmail = json.email
  const rawPhone = json.phone
  json.contactPreview = { email: maskEmail(rawEmail), phone: maskPhone(rawPhone) }
  json.unlocked = !!unlocked
  if (!unlocked) {
    json.email = null
    json.phone = null
  }
  json.resumeUrl = null
  return json
}

async function unlockedCandidateIdSet(companyId, candidateIds) {
  const rows = await CandidateUnlock.find({ company: companyId, candidate: { $in: candidateIds } }).select('candidate')
  return new Set(rows.map((r) => r.candidate.toString()))
}

async function redactList(companyId, candidates) {
  const isList = Array.isArray(candidates)
  const list = isList ? candidates : [candidates]
  const unlockedIds = await unlockedCandidateIdSet(companyId, list.map((c) => c._id))
  const redacted = list.map((c) => redactCandidate(c, unlockedIds.has(c._id.toString())))
  return isList ? redacted : redacted[0]
}

// Mints a fresh, short-lived signed resume link for a candidate whose
// Employee record has a verified resume — same token mechanism as
// resumeAccess.js everywhere else. Returns null (never throws) when no
// resume is available, so callers can render "not available" instead of 500ing.
async function resolveCandidateResumeUrl(candidate, purpose) {
  if (!candidate.employee) return null
  const employee = await Employee.findById(candidate.employee).select('resume.status resume.file resume.url +resume.s3Key')
  const resume = employee?.resume
  if (!resume || resume.status !== 'verified') return null
  return resume.s3Key ? buildResumeAccessPath(resume.s3Key, resume.file, purpose) : resume.url ?? null
}

export const listCandidates = asyncHandler(async (req, res) => {
  const { search, jobId, stage } = req.query
  const query = { company: req.company._id }

  if (jobId && jobId !== 'all') query.job = jobId
  if (stage && stage !== 'all') query.stage = stage
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ name: regex }, { appliedFor: regex }, { skills: regex }]
  }

  const { data, page, limit, total } = await paginate(Candidate, query, paginationParams(req), { sort: { sharedOn: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(await redactList(req.company._id, data))
})

export const getCandidate = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })

  const unlock = await CandidateUnlock.findOne({ company: req.company._id, candidate: candidate._id })
  const json = redactCandidate(candidate, !!unlock)
  if (unlock) {
    json.resumeUrl = await resolveCandidateResumeUrl(candidate, 'employer-cv-credit-unlock')
  }
  res.json(json)
})

// POST /api/employer/candidates/:id/unlock — spends 1 CV credit to unlock
// this candidate's contact details + resume for this employer, permanently
// (idempotent: calling again just returns the existing unlock, no further
// charge — see unlockCandidateForCredit).
export const unlockCandidate = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })

  let result
  try {
    result = await unlockCandidateForCredit({
      companyId: req.company._id,
      candidateId: candidate._id,
      jobId: candidate.job ?? null,
      userId: req.user._id,
    })
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      logger.info({ companyId: req.company._id.toString(), candidateId: candidate._id.toString() }, 'CV unlock failed — insufficient credits')
      return res.status(402).json({ code: 'INSUFFICIENT_CREDITS', message: 'You have no CV credits remaining. Buy more credits to unlock this candidate.' })
    }
    throw err
  }

  if (!result.alreadyUnlocked) {
    // The credit spend + CandidateUnlock grant already committed — a
    // failure logging this cosmetic activity-feed note must never make the
    // unlock itself look like it failed.
    try {
      await logActivity(req.company._id, `Unlocked ${candidate.name}'s contact details (1 CV credit)`, 'gold')
    } catch (err) {
      logger.warn({ err }, 'Failed to log company activity for CV unlock')
    }
  }

  const wallet = await getWalletBalance(req.company._id)
  const json = redactCandidate(candidate, true)
  json.resumeUrl = await resolveCandidateResumeUrl(candidate, 'employer-cv-credit-unlock')

  res.json({ candidate: json, wallet, alreadyUnlocked: result.alreadyUnlocked, unlock: result.unlock })
})

export const setCandidateStage = asyncHandler(async (req, res) => {
  const { stage, rejectionReason } = req.body ?? {}
  if (!stage) return res.status(400).json({ message: 'stage is required' })

  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })

  const wasHired = candidate.stage === 'hired'
  candidate.stage = stage
  if (rejectionReason) candidate.rejectionReason = rejectionReason

  await candidate.save()

  if (stage === 'hired' && !wasHired) {
    await logActivity(req.company._id, `${candidate.name} marked as hired`, 'green')
    if (candidate.batch) await Batch.findByIdAndUpdate(candidate.batch, { $inc: { selected: 1 } })
  } else if (wasHired && stage !== 'hired' && candidate.batch) {
    await Batch.findByIdAndUpdate(candidate.batch, { $inc: { selected: -1 } })
  }

  res.json(await redactList(req.company._id, candidate))
})

// GET /api/employer/candidates/:id/private-details — email + phone, only for
// an active-subscription employer viewing a candidate genuinely shared with
// their own company. Every call is logged.
export const getCandidatePrivateDetails = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })

  const active = await hasActiveEmployerSubscription(req.company._id)
  if (!active) {
    return res.status(403).json({ code: 'EMPLOYER_SUBSCRIPTION_REQUIRED', message: 'Activate your employer plan to view applicant contact details.' })
  }

  await ResumeAccessLog.create({
    company: req.company._id,
    candidate: candidate._id,
    employee: candidate.employee,
    application: candidate.application,
    action: 'private_details_viewed',
    accessedBy: req.user._id,
  })

  res.json({ email: candidate.email, phone: candidate.phone })
})

// GET /api/employer/candidates/:id/resume-url — mints a fresh, short-lived
// signed resume link (same token mechanism as resumeAccess.js everywhere
// else) only for an active-subscription employer, only for a candidate
// actually shared with their own company. The employer never sees the S3
// key or a permanent URL — only this 10-minute token, which itself redeems
// through a 60-second presigned S3 GET (see fileAccessController.js).
export const getCandidateResumeUrl = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })

  const active = await hasActiveEmployerSubscription(req.company._id)
  if (!active) {
    return res.status(403).json({ code: 'EMPLOYER_SUBSCRIPTION_REQUIRED', message: 'Activate your employer plan to view applicant resumes.' })
  }

  if (!candidate.employee) return res.status(404).json({ message: 'Resume not available for this candidate' })

  const employee = await Employee.findById(candidate.employee).select('resume.status resume.file resume.url +resume.s3Key')
  const resume = employee?.resume
  if (!resume || resume.status !== 'verified') {
    return res.status(404).json({ message: 'Resume not available for this candidate' })
  }

  const url = resume.s3Key ? buildResumeAccessPath(resume.s3Key, resume.file, 'employer-resume') : resume.url ?? null
  if (!url) return res.status(404).json({ message: 'Resume not available for this candidate' })

  await ResumeAccessLog.create({
    company: req.company._id,
    candidate: candidate._id,
    employee: candidate.employee,
    application: candidate.application,
    action: 'resume_viewed',
    accessedBy: req.user._id,
  })

  res.json({ url })
})
