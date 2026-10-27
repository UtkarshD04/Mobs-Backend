import { escapeRegex } from '../utils/jobQueryFilters.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { logActivity } from '../utils/activityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Candidate from '../models/Candidate.js'
import Batch from '../models/Batch.js'
import Employee from '../models/Employee.js'
import ResumeAccessLog from '../models/ResumeAccessLog.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import { REVEAL_PARTS, revealedParts, parseRevealField } from '../utils/candidateReveal.js'
import { buildResumeAccessPath, buildLegacyResumeAccessPath } from '../utils/resumeAccess.js'
import { hasActiveEmployerSubscription } from '../utils/employerSubscriptionAccess.js'
import { unlockCandidateForCredit, getWalletBalance, InsufficientCreditsError } from '../utils/creditWallet.js'
import { logger } from '../config/logger.js'
import { markApplicationViewed, syncApplicationStatusFromStage } from '../utils/applicationSync.js'
import { env } from '../config/env.js'
import { FEEDBACK_REASONS, toEmployerView, validateSubmission } from '../utils/rejectionFeedback.js'
import { recordRejectionFeedback } from '../utils/rejectionFeedbackService.js'
import RejectionFeedback from '../models/RejectionFeedback.js'
import { audit } from '../utils/audit.js'
import { recordEvent } from './applicantsController.js'
import { pipelineStageOf, STAGE_LABELS } from '../utils/pipeline.js'

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

// Fully masked — not even the last digits are shown before the unlock. Capped
// at 10 so a +91 prefix doesn't make the mask longer than the number itself.
export function maskPhone(phone) {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null
  return '*'.repeat(Math.min(digits.length, 10))
}

// Resume, email and phone are private candidate data — they are stripped
// from every list/detail response unless this specific employer has spent a
// CV credit to unlock this specific candidate (`unlocked`). This keeps a
// bulk `GET /candidates` call from ever leaking private data for a
// candidate nobody has paid to unlock, credit balance or not.
//
// Unlocking is per part: one credit buys the candidate, but email, phone and
// resume are each opened on their own click (`revealed`, a Set of
// 'email' | 'phone' | 'resume'; null = all three, for callers that don't track
// parts). Only a revealed part is ever sent.
// Exported for direct unit testing (see candidateRedaction.test.js).
export function redactCandidate(candidate, unlocked, revealed = null) {
  const json = typeof candidate.toJSON === 'function' ? candidate.toJSON() : candidate
  const rawEmail = json.email
  const rawPhone = json.phone
  const parts = unlocked ? (revealed ?? new Set(REVEAL_PARTS)) : new Set()
  json.contactPreview = { email: maskEmail(rawEmail), phone: maskPhone(rawPhone) }
  json.unlocked = !!unlocked
  json.revealed = [...parts]
  if (!parts.has('email')) json.email = null
  if (!parts.has('phone')) json.phone = null
  json.resumeUrl = null
  return json
}

// candidateId → the parts revealed for it (only candidates this company has paid for).
async function revealedPartsByCandidateId(companyId, candidateIds) {
  const rows = await CandidateUnlock.find({ company: companyId, candidate: { $in: candidateIds } }).select('candidate revealed')
  return new Map(rows.map((r) => [r.candidate.toString(), revealedParts(r)]))
}

async function redactList(companyId, candidates) {
  const isList = Array.isArray(candidates)
  const list = isList ? candidates : [candidates]
  const partsById = await revealedPartsByCandidateId(companyId, list.map((c) => c._id))
  const redacted = list.map((c) => redactCandidate(c, partsById.has(c._id.toString()), partsById.get(c._id.toString())))
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
  if (resume.s3Key) return buildResumeAccessPath(resume.s3Key, resume.file, purpose)
  return resume.url ? buildLegacyResumeAccessPath(resume.url, resume.file, purpose) : null
}

// Best-effort: the employer's view must never fail because the candidate-side
// "viewed" marker couldn't be saved.
async function recordEmployerView(candidate) {
  try {
    await markApplicationViewed(candidate.application)
  } catch (err) {
    logger.warn({ err }, 'Failed to mark application as viewed by employer')
  }
}

export const listCandidates = asyncHandler(async (req, res) => {
  const { search, jobId, stage } = req.query
  const query = { company: req.company._id }

  if (jobId && jobId !== 'all') query.job = jobId
  if (stage && stage !== 'all') query.stage = stage
  if (search) {
    const regex = new RegExp(escapeRegex(String(search)), 'i')
    query.$or = [{ name: regex }, { appliedFor: regex }, { skills: regex }]
  }

  const { data, page, limit, total } = await paginate(Candidate, query, paginationParams(req), { sort: { premium: -1, sharedOn: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(await redactList(req.company._id, data))
})

export const getCandidate = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })

  await recordEmployerView(candidate)

  const unlock = await CandidateUnlock.findOne({ company: req.company._id, candidate: candidate._id })
  const parts = revealedParts(unlock)
  const json = redactCandidate(candidate, !!unlock, parts)
  if (parts.has('resume')) {
    json.resumeUrl = await resolveCandidateResumeUrl(candidate, 'employer-cv-credit-unlock')
  }
  res.json(json)
})

// POST /api/employer/candidates/:id/unlock — spends 1 CV credit to unlock
// this candidate's contact details + resume for this employer, permanently
// (idempotent: calling again just returns the existing unlock, no further
// charge — see unlockCandidateForCredit).
export const unlockCandidate = asyncHandler(async (req, res) => {
  const reveal = parseRevealField(req.body?.field)
  if (!reveal) return res.status(400).json({ message: 'field must be one of: email, phone, resume' })

  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })

  let result
  try {
    result = await unlockCandidateForCredit({
      companyId: req.company._id,
      candidateId: candidate._id,
      jobId: candidate.job ?? null,
      userId: req.user._id,
      reveal,
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
      await audit(req, 'cv.unlocked', { targetType: 'candidate', targetId: candidate._id, targetLabel: candidate.name, detail: `${req.body?.field ?? 'details'} · 1 CV credit` })
    } catch (err) {
      logger.warn({ err }, 'Failed to log company activity for CV unlock')
    }
  }

  const wallet = await getWalletBalance(req.company._id)
  const parts = revealedParts(result.unlock)
  const json = redactCandidate(candidate, true, parts)
  if (parts.has('resume')) json.resumeUrl = await resolveCandidateResumeUrl(candidate, 'employer-cv-credit-unlock')

  res.json({ candidate: json, wallet, alreadyUnlocked: result.alreadyUnlocked, unlock: result.unlock })
})

export const setCandidateStage = asyncHandler(async (req, res) => {
  const { stage, rejectionReason, feedback: feedbackInput } = req.body ?? {}
  if (!stage) return res.status(400).json({ message: 'stage is required' })

  // Rejecting takes structured feedback (stage reached + at least one reason). It is validated before anything
  // is saved, so a bad submission can't leave the candidate rejected with no feedback record.
  let feedbackValue = null
  if (stage === 'rejected') {
    if (feedbackInput !== undefined) {
      const { value, errors } = validateSubmission(feedbackInput)
      if (errors) return res.status(400).json({ message: 'Please fix the highlighted fields.', errors })
      feedbackValue = value
    } else if (env.rejectionFeedbackRequired) {
      return res.status(400).json({ code: 'FEEDBACK_REQUIRED', message: 'Select at least one reason before rejecting this candidate.' })
    }
  }

  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })

  // Already rejected. A repeat click must not create a second rejection, but an employer who was rejected without any
  // feedback (older app build, or a follow-up from Mzobs) can still supply it now. Feedback that exists is changed
  // only through the resubmit route, and only when a reviewer has asked for it.
  if (stage === 'rejected' && candidate.stage === 'rejected' && feedbackValue) {
    if (await RejectionFeedback.exists({ candidate: candidate._id })) {
      return res.status(409).json({ code: 'ALREADY_REJECTED', message: 'This candidate was already rejected. If Mzobs asked you to update the feedback, use Feedback follow-ups.' })
    }
    if (!candidate.application || !candidate.employee) return res.status(409).json({ code: 'ALREADY_REJECTED', message: 'This candidate was already rejected.' })
    const recorded = await recordRejectionFeedback({ candidate, userId: req.user._id, value: feedbackValue })
    return res.json({ ...(await redactList(req.company._id, candidate)), feedback: { ...toEmployerView(recorded.feedback), result: recorded.result } })
  }

  // A rejection can't go out without a reason: structured feedback (validated above) or, for older clients, a few words of free text.
  // Neither is shown to the candidate as written: they only ever see feedback a Mzobs reviewer approved.
  const reason = String(rejectionReason ?? '').trim()
  if (stage === 'rejected' && !feedbackValue && reason.length < 5) {
    return res.status(400).json({ code: 'REJECTION_REASON_REQUIRED', message: 'Tell the candidate why they were not selected (a few words is enough).' })
  }

  const fromKey = pipelineStageOf(candidate)
  const wasHired = candidate.stage === 'hired'
  const wasOffered = candidate.stage === 'offered'
  candidate.stage = stage
  candidate.stageChangedAt = new Date()
  if (feedbackValue) candidate.rejectionReason = feedbackValue.reasons.map((code) => FEEDBACK_REASONS[code].label).join('; ')
  else if (stage === 'rejected') candidate.rejectionReason = reason.slice(0, 500)

  await candidate.save()

  // Same history and audit entries the Applicants page writes, so the trail is complete whichever client moved them.
  const toKey = pipelineStageOf(candidate)
  if (toKey !== fromKey) {
    await recordEvent(req, candidate, stage === 'rejected' ? 'reject' : 'stage', `${stage === 'rejected' ? 'Rejected from' : 'Moved from'} ${STAGE_LABELS[fromKey]}${stage === 'rejected' ? '' : ` to ${STAGE_LABELS[toKey]}`}`, { from: fromKey, to: toKey })
    await audit(req, stage === 'rejected' ? 'candidate.rejected' : 'candidate.moved', { targetType: 'candidate', targetId: candidate._id, targetLabel: candidate.name, detail: `${STAGE_LABELS[fromKey]} → ${STAGE_LABELS[toKey]}` })
  }

  try {
    await syncApplicationStatusFromStage(candidate, stage)
  } catch (err) {
    logger.warn({ err }, 'Failed to sync candidate stage onto the application')
  }

  if (stage === 'offered' && !wasOffered) {
    try {
      await notifyApplicationOffered(candidate)
    } catch (err) {
      logger.warn({ err }, 'Failed to notify the candidate about the offer')
    }
  }

  if (stage === 'hired' && !wasHired) {
    await logActivity(req.company._id, `${candidate.name} marked as hired`, 'green')
    if (candidate.batch) await Batch.findByIdAndUpdate(candidate.batch, { $inc: { selected: 1 } })
  } else if (wasHired && stage !== 'hired' && candidate.batch) {
    await Batch.findByIdAndUpdate(candidate.batch, { $inc: { selected: -1 } })
  }

  // Feedback only makes sense for a platform candidate who actually applied (there is no application page to
  // show it on otherwise). The stage change is already saved, so a failure here is surfaced, not swallowed.
  let feedback = null
  if (feedbackValue && candidate.application && candidate.employee) {
    try {
      const recorded = await recordRejectionFeedback({ candidate, userId: req.user._id, value: feedbackValue })
      feedback = { ...toEmployerView(recorded.feedback), result: recorded.result }
    } catch (err) {
      // The rejection stands (it never waits on review); Mzobs will chase the missing feedback as a follow-up.
      logger.error({ err }, 'Failed to save rejection feedback after rejecting a candidate')
      const body = await redactList(req.company._id, candidate)
      return res.json({ ...body, feedbackSaved: false, message: 'The candidate was rejected, but the feedback could not be saved. Please submit it again from the candidate page.' })
    }
  }

  const body = await redactList(req.company._id, candidate)
  res.json(feedback ? { ...body, feedback } : body)
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

  const url = resume.s3Key
    ? buildResumeAccessPath(resume.s3Key, resume.file, 'employer-resume')
    : resume.url
      ? buildLegacyResumeAccessPath(resume.url, resume.file, 'employer-resume')
      : null
  if (!url) return res.status(404).json({ message: 'Resume not available for this candidate' })

  await ResumeAccessLog.create({
    company: req.company._id,
    candidate: candidate._id,
    employee: candidate.employee,
    application: candidate.application,
    action: 'resume_viewed',
    accessedBy: req.user._id,
  })
  await recordEmployerView(candidate)

  res.json({ url })
})
