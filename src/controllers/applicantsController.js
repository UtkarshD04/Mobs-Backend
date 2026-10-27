import mongoose from 'mongoose'
import { asyncHandler } from '../utils/asyncHandler.js'
import { escapeRegex } from '../utils/jobQueryFilters.js'
import { logger } from '../config/logger.js'
import { audit } from '../utils/audit.js'
import { can } from '../utils/permissions.js'
import { PIPELINE_STAGES, STAGE_LABELS, dbStageFor, pipelineStageOf, stageFilter, matchHighlights, requirementMatch, toLpa, toNoticeDays, averageRating } from '../utils/pipeline.js'
import { syncApplicationStatusFromStage, notifyApplicationOffered } from '../utils/applicationSync.js'
import { FEEDBACK_REASONS, PORTAL_REASONS, validateSubmission } from '../utils/rejectionFeedback.js'
import { recordRejectionFeedback } from '../utils/rejectionFeedbackService.js'
import Candidate from '../models/Candidate.js'
import CandidateEvent from '../models/CandidateEvent.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import Employee from '../models/Employee.js'
import Interview from '../models/Interview.js'
import Offer from '../models/Offer.js'
import Job from '../models/Job.js'
import Batch from '../models/Batch.js'
import User from '../models/User.js'
import { logActivity } from '../utils/activityLog.js'
import { initialsOf } from '../utils/initials.js'

const MAX_TAGS = 10
const MAX_TAG_LEN = 30
const MAX_BULK = 100
const MAX_LIST = 300
const NOTE_MAX = 2000
const isId = (v) => mongoose.isValidObjectId(v)
// Aggregation $match does not cast strings the way find() does, so ids that reach it are converted up front.
const oid = (v) => new mongoose.Types.ObjectId(String(v))

// Interviewers only ever see candidates they are on the panel for.
async function assignedCandidateIds(req) {
  const rows = await Interview.find({ company: req.company._id, 'interviewers.user': req.user._id }).select('candidate')
  return [...new Set(rows.map((r) => String(r.candidate)))].map(oid)
}

async function scopeFor(req) {
  if (can(req.user.role, 'candidates.view')) return {}
  if (can(req.user.role, 'candidates.viewAssigned')) return { _id: { $in: await assignedCandidateIds(req) } }
  return null
}

export async function recordEvent(req, candidate, type, text, meta = null) {
  try {
    await CandidateEvent.create({ company: req.company._id, candidate: candidate._id, job: candidate.job ?? null, type, actor: req.user?._id ?? null, actorName: req.user?.name ?? '', text, meta })
  } catch (err) {
    logger.warn({ err, type }, 'Failed to record candidate event')
  }
}

function shapeCandidate(c, { job, unlockedIds, ownerName }) {
  const stage = pipelineStageOf(c)
  return {
    id: c._id.toString(),
    name: c.name,
    initials: initialsOf(c.name),
    currentRole: c.workHistory?.[0]?.role || c.headline || c.appliedFor || '',
    currentCompany: c.workHistory?.[0]?.company || '',
    appliedFor: c.appliedFor,
    experienceYears: c.experienceYears ?? 0,
    location: c.location || '',
    appliedAt: c.sharedOn ?? c.createdAt,
    stage,
    stageChangedAt: c.stageChangedAt ?? null,
    owner: c.owner ? { id: String(c.owner._id ?? c.owner), name: ownerName ?? c.owner.name ?? '' } : null,
    tags: c.tags ?? [],
    followUpOn: c.followUpOn ?? null,
    skills: c.skills ?? [],
    highlights: matchHighlights(c, job),
    premium: !!c.premium,
    unlocked: unlockedIds.has(String(c._id)),
    jobId: c.job ? String(c.job._id ?? c.job) : null,
    jobTitle: job?.title ?? '',
  }
}

const JOB_FIELDS = 'title skills experienceMin experienceMax location salaryMin salaryMax status'

export const listApplicants = asyncHandler(async (req, res) => {
  const scope = await scopeFor(req)
  if (!scope) return res.status(403).json({ code: 'FORBIDDEN', message: 'Your role cannot view applicants.' })

  const { jobId, q, stage, owner, tag, city, followUp, sort = 'recent' } = req.query
  const base = { company: req.company._id, ...scope }
  if (jobId && jobId !== 'all') {
    if (!isId(jobId)) return res.status(400).json({ message: 'Invalid jobId' })
    base.job = oid(jobId)
  }
  if (q) {
    const rx = new RegExp(escapeRegex(String(q).slice(0, 80)), 'i')
    base.$or = [{ name: rx }, { appliedFor: rx }, { skills: rx }, { headline: rx }]
  }
  if (owner === 'unassigned') base.owner = null
  else if (owner === 'me') base.owner = req.user._id
  else if (isId(owner)) base.owner = oid(owner)
  if (tag) base.tags = String(tag).slice(0, MAX_TAG_LEN)
  if (city) base.location = new RegExp(escapeRegex(String(city).slice(0, 60)), 'i')
  if (followUp === 'due') base.followUpOn = { $ne: null, $lte: new Date() }
  const minExp = Number(req.query.minExp)
  const maxExp = Number(req.query.maxExp)
  if (req.query.minExp !== undefined && Number.isFinite(minExp)) base.experienceYears = { ...base.experienceYears, $gte: minExp }
  if (req.query.maxExp !== undefined && Number.isFinite(maxExp)) base.experienceYears = { ...base.experienceYears, $lte: maxExp }

  const query = { ...base }
  if (stage && stage !== 'all') {
    const f = stageFilter(stage)
    if (!f) return res.status(400).json({ message: 'Unknown stage' })
    Object.assign(query, f)
  }

  const SORTS = { recent: { sharedOn: -1 }, oldest: { sharedOn: 1 }, experience: { experienceYears: -1 }, name: { name: 1 }, followUp: { followUpOn: 1 } }
  const [rows, countRows, total] = await Promise.all([
    Candidate.find(query).sort(SORTS[sort] ?? SORTS.recent).limit(MAX_LIST).populate('owner', 'name').populate('job', JOB_FIELDS),
    Candidate.aggregate([{ $match: base }, { $group: { _id: { stage: '$stage', reviewed: { $gt: ['$reviewedAt', null] } }, n: { $sum: 1 } } }]),
    Candidate.countDocuments(query),
  ])

  const counts = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0]))
  for (const r of countRows) counts[pipelineStageOf({ stage: r._id.stage, reviewedAt: r._id.reviewed ? new Date() : null })] += r.n

  const unlocks = await CandidateUnlock.find({ company: req.company._id, candidate: { $in: rows.map((r) => r._id) } }).select('candidate')
  const unlockedIds = new Set(unlocks.map((u) => String(u.candidate)))
  res.json({ items: rows.map((c) => shapeCandidate(c, { job: c.job, unlockedIds })), counts, total, truncated: total > rows.length })
})

// Per-job stage counts for the job picker / Applicants landing.
export const applicantsSummary = asyncHandler(async (req, res) => {
  const scope = await scopeFor(req)
  if (!scope) return res.status(403).json({ code: 'FORBIDDEN', message: 'Your role cannot view applicants.' })
  const jobs = await Job.find({ company: req.company._id, status: { $ne: 'archived' } }).select('title status location department vacancies createdAt').sort({ createdAt: -1 })
  const rows = await Candidate.aggregate([
    { $match: { company: req.company._id, job: { $in: jobs.map((j) => j._id) }, ...scope } },
    { $group: { _id: { job: '$job', stage: '$stage', reviewed: { $gt: ['$reviewedAt', null] } }, n: { $sum: 1 } } },
  ])
  const byJob = new Map()
  for (const r of rows) {
    const key = String(r._id.job)
    const counts = byJob.get(key) ?? Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0]))
    counts[pipelineStageOf({ stage: r._id.stage, reviewedAt: r._id.reviewed ? new Date() : null })] += r.n
    byJob.set(key, counts)
  }
  res.json(
    jobs.map((j) => {
      const counts = byJob.get(String(j._id)) ?? Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0]))
      return { id: j._id.toString(), title: j.title, status: j.status, location: j.location, department: j.department, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }
    })
  )
})

async function loadOwned(req, id, { notes = false } = {}) {
  if (!isId(id)) return null
  const q = Candidate.findOne({ _id: id, company: req.company._id })
  return notes ? q.select('+notes') : q
}

export const getApplicant = asyncHandler(async (req, res) => {
  const c = await loadOwned(req, req.params.id, { notes: true })
  if (!c) return res.status(404).json({ message: 'Candidate not found' })
  const scope = await scopeFor(req)
  if (!scope) return res.status(403).json({ code: 'FORBIDDEN', message: 'Your role cannot view applicants.' })
  if (scope._id && !scope._id.$in.some((id) => String(id) === String(c._id))) return res.status(403).json({ code: 'FORBIDDEN', message: 'You can only view candidates you interview.' })

  await c.populate([{ path: 'owner', select: 'name' }, { path: 'job', select: JOB_FIELDS }])
  const [unlock, events, interviews, offers] = await Promise.all([
    CandidateUnlock.exists({ company: req.company._id, candidate: c._id }),
    CandidateEvent.find({ company: req.company._id, candidate: c._id }).sort({ createdAt: -1 }).limit(200),
    Interview.find({ company: req.company._id, candidate: c._id }).sort({ startsAt: -1 }),
    Offer.find({ company: req.company._id, candidate: c._id }).sort({ sentOn: -1 }),
  ])
  const base = shapeCandidate(c, { job: c.job, unlockedIds: new Set(unlock ? [String(c._id)] : []) })
  const canSeeNotes = can(req.user.role, 'candidates.manage') || can(req.user.role, 'candidates.view')
  res.json({
    ...base,
    headline: c.headline,
    education: c.education,
    workHistory: c.workHistory,
    projects: c.projects,
    expectedSalary: c.expectedSalary,
    availability: c.availability,
    notes: canSeeNotes ? c.notes.map((n) => ({ id: n._id.toString(), text: n.text, kind: n.kind, byName: n.byName, at: n.at })).reverse() : [],
    events: events.map((e) => ({ id: e._id.toString(), type: e.type, text: e.text, actorName: e.actorName, at: e.createdAt, meta: e.type === 'comm' ? e.meta : e.type === 'stage' ? e.meta : null })),
    interviews: interviews.map((i) => ({ id: i._id.toString(), round: i.round, startsAt: i.startsAt, status: i.status, scorecards: i.scorecards.length, interviewers: i.interviewers.length })),
    offers: offers.map((o) => ({ id: o._id.toString(), status: o.status, ctc: o.ctc, expiresOn: o.expiresOn })),
  })
})

// ---- stage moves -------------------------------------------------------------------------------------------------

// Applies one non-rejecting stage move. Mirrors what PATCH /candidates/:id/stage does for the same transitions, so the
// candidate's application, hiring batch and notifications behave the same whichever screen moved them.
async function applyMove(req, candidate, to) {
  const from = pipelineStageOf(candidate)
  if (from === to) return false
  const wasHired = candidate.stage === 'hired'
  const wasOffered = candidate.stage === 'offered'
  const dbStage = dbStageFor(to)

  candidate.stage = dbStage
  candidate.reviewedAt = to === 'reviewed' ? candidate.reviewedAt ?? new Date() : to === 'new' ? null : candidate.reviewedAt ?? new Date()
  candidate.stageChangedAt = new Date()
  if (from === 'rejected') candidate.rejectionReason = null
  await candidate.save()

  try {
    await syncApplicationStatusFromStage(candidate, dbStage)
  } catch (err) {
    logger.warn({ err }, 'Failed to sync candidate stage onto the application')
  }
  if (dbStage === 'offered' && !wasOffered) {
    try {
      await notifyApplicationOffered(candidate)
    } catch (err) {
      logger.warn({ err }, 'Failed to notify the candidate about the offer')
    }
  }
  if (dbStage === 'hired' && !wasHired) {
    await logActivity(req.company._id, `${candidate.name} marked as hired`, 'green')
    if (candidate.batch) await Batch.findByIdAndUpdate(candidate.batch, { $inc: { selected: 1 } })
  } else if (wasHired && dbStage !== 'hired' && candidate.batch) {
    await Batch.findByIdAndUpdate(candidate.batch, { $inc: { selected: -1 } })
  }

  await recordEvent(req, candidate, 'stage', `Moved from ${STAGE_LABELS[from]} to ${STAGE_LABELS[to]}`, { from, to })
  await audit(req, 'candidate.moved', { targetType: 'candidate', targetId: candidate._id, targetLabel: candidate.name, detail: `${STAGE_LABELS[from]} → ${STAGE_LABELS[to]}` })
  return true
}

const MOVABLE = PIPELINE_STAGES.filter((s) => s !== 'rejected')

export const moveApplicant = asyncHandler(async (req, res) => {
  const { stage } = req.body ?? {}
  if (stage === 'rejected') return res.status(400).json({ code: 'REJECT_NEEDS_REASON', message: 'Use the reject action so the reason can be recorded.' })
  if (!MOVABLE.includes(stage)) return res.status(400).json({ message: 'stage must be one of: ' + MOVABLE.join(', ') })
  const c = await loadOwned(req, req.params.id)
  if (!c) return res.status(404).json({ message: 'Candidate not found' })
  await applyMove(req, c, stage)
  res.json({ id: c._id.toString(), stage: pipelineStageOf(c) })
})

// Bulk edit: { ids, stage?, ownerId?, addTags? }. Rejection is deliberately not available here.
export const bulkUpdate = asyncHandler(async (req, res) => {
  const { ids, stage, ownerId, addTags } = req.body ?? {}
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BULK || !ids.every(isId)) return res.status(400).json({ message: `Select between 1 and ${MAX_BULK} candidates.` })
  if (stage === 'rejected') return res.status(400).json({ code: 'REJECT_NEEDS_REASON', message: 'Candidates are rejected one at a time so each gets a recorded reason.' })
  if (stage !== undefined && !MOVABLE.includes(stage)) return res.status(400).json({ message: 'Unknown stage' })
  if (stage === undefined && ownerId === undefined && !addTags) return res.status(400).json({ message: 'Nothing to change' })

  let owner
  if (ownerId !== undefined && ownerId !== null) {
    owner = await User.findOne({ _id: ownerId, company: req.company._id, status: { $ne: 'disabled' } }).select('name')
    if (!owner) return res.status(400).json({ message: 'That team member was not found.' })
  }
  const tags = Array.isArray(addTags) ? cleanTags(addTags) : null

  const candidates = await Candidate.find({ _id: { $in: ids }, company: req.company._id })
  let moved = 0
  for (const c of candidates) {
    if (stage && (await applyMove(req, c, stage))) moved++
    if (ownerId !== undefined) {
      c.owner = owner?._id ?? null
      await recordEvent(req, c, 'assign', owner ? `Assigned to ${owner.name}` : 'Unassigned')
      await audit(req, 'candidate.assigned', { targetType: 'candidate', targetId: c._id, targetLabel: c.name, detail: owner ? `to ${owner.name}` : 'unassigned' })
    }
    if (tags?.length) c.tags = cleanTags([...(c.tags ?? []), ...tags])
    if (ownerId !== undefined || tags?.length) await c.save()
  }
  res.json({ updated: candidates.length, moved })
})

function cleanTags(list) {
  const seen = new Set()
  const out = []
  for (const t of list) {
    const v = String(t ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LEN)
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase())
      out.push(v)
    }
  }
  return out.slice(0, MAX_TAGS)
}

export const updateApplicant = asyncHandler(async (req, res) => {
  const { ownerId, tags, followUpOn } = req.body ?? {}
  const c = await loadOwned(req, req.params.id)
  if (!c) return res.status(404).json({ message: 'Candidate not found' })

  if (ownerId !== undefined) {
    if (ownerId === null) c.owner = null
    else {
      const owner = await User.findOne({ _id: isId(ownerId) ? ownerId : null, company: req.company._id, status: { $ne: 'disabled' } }).select('name')
      if (!owner) return res.status(400).json({ message: 'That team member was not found.' })
      c.owner = owner._id
      await recordEvent(req, c, 'assign', `Assigned to ${owner.name}`)
      await audit(req, 'candidate.assigned', { targetType: 'candidate', targetId: c._id, targetLabel: c.name, detail: `to ${owner.name}` })
    }
    if (ownerId === null) await recordEvent(req, c, 'assign', 'Unassigned')
  }
  if (tags !== undefined) {
    if (!Array.isArray(tags)) return res.status(400).json({ message: 'tags must be a list' })
    c.tags = cleanTags(tags)
    await recordEvent(req, c, 'tags', c.tags.length ? `Tags set: ${c.tags.join(', ')}` : 'Tags cleared')
  }
  if (followUpOn !== undefined) {
    if (followUpOn === null || followUpOn === '') c.followUpOn = null
    else {
      const d = new Date(followUpOn)
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Follow-up date is not valid.' })
      c.followUpOn = d
    }
    await recordEvent(req, c, 'followup', c.followUpOn ? `Follow-up set for ${c.followUpOn.toLocaleDateString('en-IN')}` : 'Follow-up cleared')
  }
  await c.save()
  res.json({ ok: true })
})

export const addNote = asyncHandler(async (req, res) => {
  const text = String(req.body?.text ?? '').trim()
  if (text.length < 2) return res.status(400).json({ message: 'Write a note first.' })
  if (text.length > NOTE_MAX) return res.status(400).json({ message: `Keep notes under ${NOTE_MAX} characters.` })
  const c = await Candidate.findOne({ _id: isId(req.params.id) ? req.params.id : null, company: req.company._id }).select('+notes')
  if (!c) return res.status(404).json({ message: 'Candidate not found' })
  c.notes.push({ text, kind: 'note', by: req.user._id, byName: req.user.name })
  await c.save()
  await recordEvent(req, c, 'note', 'Added a private note')
  res.status(201).json({ ok: true })
})

// ---- rejection ---------------------------------------------------------------------------------------------------

export const rejectionOptions = (_req, res) => {
  res.json(PORTAL_REASONS.map((code) => ({ code, label: FEEDBACK_REASONS[code].label })))
}

// POST /applicants/:id/reject { internalReason, shareFeedback, candidateReasons[] }
//   internalReason  — private to the employer's team (and MZOBS reviewers); never shown to the candidate.
//   shareFeedback   — explicit opt-in. Only then are candidateReasons sent for MZOBS review, and the candidate sees nothing
//                     until a reviewer approves their "Application Insights" wording (see utils/rejectionFeedback.js).
export const rejectApplicant = asyncHandler(async (req, res) => {
  const internalReason = String(req.body?.internalReason ?? '').trim()
  const share = req.body?.shareFeedback === true
  const reasons = Array.isArray(req.body?.candidateReasons) ? [...new Set(req.body.candidateReasons.filter((r) => typeof r === 'string'))] : []

  const errors = {}
  if (internalReason.length < 10) errors.internalReason = 'Record a brief internal reason (at least 10 characters).'
  if (internalReason.length > 1000) errors.internalReason = 'Keep the internal reason under 1000 characters.'
  if (!share && reasons.length) errors.shareFeedback = 'Turn on “Share feedback with the candidate” to send those reasons.'
  if (share) {
    if (reasons.length === 0) errors.candidateReasons = 'Select at least one reason the candidate may see.'
    else if (reasons.length > 3) errors.candidateReasons = 'Select at most 3 reasons.'
    else if (reasons.some((r) => !PORTAL_REASONS.includes(r))) errors.candidateReasons = 'One or more reasons are not recognised.'
  }
  if (Object.keys(errors).length) return res.status(400).json({ message: 'Please fix the highlighted fields.', errors })

  const c = await Candidate.findOne({ _id: isId(req.params.id) ? req.params.id : null, company: req.company._id }).select('+notes')
  if (!c) return res.status(404).json({ message: 'Candidate not found' })
  if (c.stage === 'rejected') return res.status(409).json({ code: 'ALREADY_REJECTED', message: 'This candidate was already rejected.' })

  // The furthest point actually reached — derived, never asked, so it can't be invented.
  const completedInterview = await Interview.exists({ company: req.company._id, candidate: c._id, status: 'Completed' })
  const stageReached = c.stage === 'offered' ? 'final_round' : completedInterview || c.stage === 'interviewing' ? 'interview' : 'application_review'

  let feedbackValue = null
  if (share) {
    // Internal reason doubles as the reviewer-facing remarks; the existing validator keeps those meaningful.
    const { value, errors: fbErrors } = validateSubmission({ stage: stageReached, reasons, remarks: internalReason })
    if (fbErrors) return res.status(400).json({ message: 'Please fix the highlighted fields.', errors: { internalReason: fbErrors.remarks ?? 'Write a clearer internal reason.', candidateReasons: fbErrors.reasons } })
    feedbackValue = value
  }

  const from = pipelineStageOf(c)
  c.stage = 'rejected'
  c.stageChangedAt = new Date()
  c.rejectionReason = share ? reasons.map((code) => FEEDBACK_REASONS[code].label).join('; ') : null
  c.notes.push({ text: internalReason, kind: 'rejection', by: req.user._id, byName: req.user.name })
  await c.save()

  try {
    await syncApplicationStatusFromStage(c, 'rejected')
  } catch (err) {
    logger.warn({ err }, 'Failed to sync rejection onto the application')
  }
  if (c.batch && from === 'hired') await Batch.findByIdAndUpdate(c.batch, { $inc: { selected: -1 } })

  let feedbackShared = false
  let note = null
  if (share) {
    if (c.application && c.employee) {
      try {
        await recordRejectionFeedback({ candidate: c, userId: req.user._id, value: feedbackValue })
        feedbackShared = true
      } catch (err) {
        logger.error({ err }, 'Failed to save rejection feedback after rejecting a candidate')
        note = 'The candidate was rejected, but the feedback could not be saved for review. Please try again from the candidate page.'
      }
    } else {
      note = 'This candidate did not apply through MZOBS, so there is no application to show insights on. They were rejected without sharing feedback.'
    }
  }

  await recordEvent(req, c, 'reject', `Rejected from ${STAGE_LABELS[from]}${feedbackShared ? ' (feedback sent to MZOBS for review)' : ''}`, { from, shared: feedbackShared })
  await audit(req, 'candidate.rejected', { targetType: 'candidate', targetId: c._id, targetLabel: c.name, detail: `from ${STAGE_LABELS[from]}; feedback ${feedbackShared ? 'shared' : 'not shared'}` })
  res.json({ id: c._id.toString(), stage: 'rejected', feedbackShared, message: note })
})

// ---- comparison --------------------------------------------------------------------------------------------------

export const compareApplicants = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? [...new Set(req.body.ids.map(String))] : []
  if (ids.length < 2 || ids.length > 4 || !ids.every(isId)) return res.status(400).json({ message: 'Choose between 2 and 4 candidates to compare.' })

  const candidates = await Candidate.find({ _id: { $in: ids }, company: req.company._id }).select('+notes').populate('job', JOB_FIELDS)
  if (candidates.length !== ids.length) return res.status(404).json({ message: 'One or more candidates were not found.' })
  if (new Set(candidates.map((c) => String(c.job?._id ?? ''))).size > 1) return res.status(422).json({ code: 'DIFFERENT_JOBS', message: 'Compare candidates who applied for the same job, so the requirements line up.' })

  const [employees, interviews] = await Promise.all([
    Employee.find({ _id: { $in: candidates.map((c) => c.employee).filter(Boolean) } }).select('noticePeriod preferredLocations expectedSalaryMin expectedSalaryMax workModePreference'),
    Interview.find({ company: req.company._id, candidate: { $in: candidates.map((c) => c._id) } }),
  ])
  const empById = new Map(employees.map((e) => [String(e._id), e]))
  const job = candidates[0].job

  const items = ids.map((id) => {
    const c = candidates.find((x) => String(x._id) === id)
    const emp = c.employee ? empById.get(String(c.employee)) : null
    const cards = interviews.filter((i) => String(i.candidate) === id).flatMap((i) => i.scorecards)
    const avg = (key) => {
      const v = cards.map((s) => s.ratings?.[key]).filter(Number.isFinite)
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null
    }
    const expectedMin = emp?.expectedSalaryMin ?? null
    const expectedMax = emp?.expectedSalaryMax ?? null
    return {
      id,
      name: c.name,
      initials: initialsOf(c.name),
      stage: pipelineStageOf(c),
      skills: c.skills ?? [],
      experienceYears: c.experienceYears ?? 0,
      currentLocation: c.location || null,
      preferredLocations: emp?.preferredLocations?.length ? emp.preferredLocations : null,
      workModePreference: emp?.workModePreference?.length ? emp.workModePreference : null,
      salaryExpectation: { raw: c.expectedSalary || null, lpa: expectedMin != null ? Math.round((expectedMin / 100000) * 10) / 10 : toLpa(c.expectedSalary), maxLpa: expectedMax != null ? Math.round((expectedMax / 100000) * 10) / 10 : null },
      noticePeriod: { raw: emp?.noticePeriod || c.availability || null, days: toNoticeDays(emp?.noticePeriod || c.availability) },
      resume: {
        headline: c.headline || null,
        roles: (c.workHistory ?? []).slice(0, 3).map((w) => `${w.role} · ${w.company}${w.duration ? ` (${w.duration})` : ''}`),
        education: (c.education ?? []).slice(0, 2).map((e) => [e.degree, e.institute].filter(Boolean).join(', ')),
        projects: (c.projects ?? []).length,
        certificates: c.certificates ?? 0,
        resumeVerified: !!c.resumeVerified,
        identityVerified: !!c.identityVerified,
      },
      notes: (c.notes ?? []).filter((n) => n.kind === 'note').slice(-3).map((n) => ({ text: n.text, byName: n.byName, at: n.at })),
      interview: {
        scorecards: cards.length,
        overall: averageRating(Object.fromEntries(['communication', 'technical', 'roleFit', 'problemSolving', 'cultureFit'].map((k) => [k, avg(k)]))),
        ratings: { communication: avg('communication'), technical: avg('technical'), roleFit: avg('roleFit'), problemSolving: avg('problemSolving'), cultureFit: avg('cultureFit') },
        recommendations: cards.map((s) => s.recommendation),
      },
      match: requirementMatch(c, job),
    }
  })

  res.json({ job: job ? { id: String(job._id), title: job.title, skills: job.skills, experienceMin: job.experienceMin, experienceMax: job.experienceMax, location: job.location } : null, items })
})

// ---- export -------------------------------------------------------------------------------------------------------

const csvCell = (v) => {
  let t = String(v ?? '').replace(/\r?\n/g, ' ')
  // A cell that starts with = + - @ would run as a formula when opened in Excel; prefix it so it stays text.
  if (/^[=+\-@\t]/.test(t)) t = `'${t}`
  return /[",]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

// GET /applicants/export?jobId= — pipeline data only. Email, phone and resumes stay behind CV-credit unlocks, so are never exported.
export const exportApplicants = asyncHandler(async (req, res) => {
  const query = { company: req.company._id }
  if (req.query.jobId && req.query.jobId !== 'all') {
    if (!isId(req.query.jobId)) return res.status(400).json({ message: 'Invalid jobId' })
    query.job = req.query.jobId
  }
  const rows = await Candidate.find(query).sort({ sharedOn: -1 }).limit(5000).populate('owner', 'name').populate('job', 'title')
  const header = ['Name', 'Job', 'Stage', 'Current role', 'Experience (yrs)', 'Location', 'Expected salary', 'Availability', 'Owner', 'Tags', 'Applied on']
  const lines = [header.join(',')]
  for (const c of rows) {
    lines.push([c.name, c.job?.title, STAGE_LABELS[pipelineStageOf(c)], c.workHistory?.[0]?.role || c.headline || c.appliedFor, c.experienceYears, c.location, c.expectedSalary, c.availability, c.owner?.name, (c.tags ?? []).join('; '), (c.sharedOn ?? c.createdAt)?.toISOString().slice(0, 10)].map(csvCell).join(','))
  }
  await audit(req, 'export.run', { targetType: 'applicants', targetLabel: query.job ? 'One job' : 'All jobs', detail: `${rows.length} rows` })
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="applicants.csv"')
  res.send(`\uFEFF${lines.join('\r\n')}\r\n`)
})
