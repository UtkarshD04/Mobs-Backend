import { asyncHandler } from '../utils/asyncHandler.js'
import { logActivity } from '../utils/activityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Candidate from '../models/Candidate.js'
import Batch from '../models/Batch.js'
import Employee from '../models/Employee.js'
import ResumeAccessLog from '../models/ResumeAccessLog.js'
import { buildResumeAccessPath } from '../utils/resumeAccess.js'
import { hasActiveEmployerSubscription } from '../utils/employerSubscriptionAccess.js'

// Resume, email and phone are private candidate data — they are stripped
// from every list/detail response regardless of subscription state.
// Contact details and a fresh resume link are only ever handed out through
// the dedicated, logged /resume-url and /private-details endpoints below,
// gated on an active subscription. This keeps a bulk `GET /candidates` call
// from ever leaking private data for candidates the employer hasn't
// explicitly opened, active plan or not.
function redactCandidate(candidate) {
  const json = typeof candidate.toJSON === 'function' ? candidate.toJSON() : candidate
  json.email = null
  json.phone = null
  json.resumeUrl = null
  return json
}

async function redactList(candidates) {
  const isList = Array.isArray(candidates)
  const list = isList ? candidates : [candidates]
  const redacted = list.map(redactCandidate)
  return isList ? redacted : redacted[0]
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
  res.json(await redactList(data))
})

export const getCandidate = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })
  res.json(await redactList(candidate))
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

  res.json(await redactList(candidate))
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
