import { asyncHandler } from '../utils/asyncHandler.js'
import { logActivity } from '../utils/activityLog.js'
import { initialsOf } from '../utils/initials.js'
import Interview from '../models/Interview.js'
import Candidate from '../models/Candidate.js'
import Employee from '../models/Employee.js'
import { notifyEmployee } from '../utils/notifyEmployee.js'
import { syncApplicationStatusFromStage } from '../utils/applicationSync.js'
import { logger } from '../config/logger.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import { sendInterviewEmail } from '../utils/interviewEmail.js'
import User from '../models/User.js'
import { audit } from '../utils/audit.js'
import { can } from '../utils/permissions.js'
import { averageRating, pipelineStageOf, STAGE_LABELS } from '../utils/pipeline.js'
import { recordEvent } from './applicantsController.js'
import mongoose from 'mongoose'

async function notifyCandidateEmployee(candidateId, payload) {
  const candidate = await Candidate.findById(candidateId).select('employee')
  if (!candidate?.employee) return
  const employee = await Employee.findById(candidate.employee)
  if (employee) await notifyEmployee(employee, payload)
}

// Emails the candidate about this interview and records how it went on the interview itself. Never throws:
// a mail problem must not undo (or fail) the interview that was just saved.
async function emailCandidate(kind, interview, req) {
  try {
    const candidate = await Candidate.findById(interview.candidate)
    const [unlock, employee] = await Promise.all([
      CandidateUnlock.findOne({ company: req.company._id, candidate: interview.candidate }),
      candidate?.employee ? Employee.findById(candidate.employee).select('name email') : null,
    ])
    const result = await sendInterviewEmail({ kind, interview, candidate, employee, unlock, company: req.company, user: req.user })
    interview.email = { kind, status: result.status, to: result.to, sentAt: result.sentAt ? new Date(result.sentAt) : undefined, error: result.error }
    await interview.save()
  } catch (err) {
    logger.warn({ err }, 'Failed to email the candidate about the interview')
  }
}

const RATING_KEYS = ['communication', 'technical', 'roleFit', 'problemSolving', 'cultureFit']
export const RECOMMENDATIONS = ['Strong Yes', 'Yes', 'Maybe', 'No']

// Who still owes a scorecard. Pending only once the interview should have ended and it wasn't cancelled.
export function feedbackState(i, now = new Date()) {
  const ends = new Date(new Date(i.startsAt).getTime() + (i.durationMins ?? 30) * 60000)
  const submitted = new Set((i.scorecards ?? []).map((s) => String(s.interviewer)))
  const awaiting = (i.interviewers ?? []).filter((p) => !submitted.has(String(p.user)))
  const hasLegacy = !!(i.feedback?.notes || i.feedback?.outcome || i.feedback?.score)
  const needs = !['Cancelled'].includes(i.status) && ends <= now && (i.interviewers?.length ? awaiting.length > 0 : submitted.size === 0 && !hasLegacy)
  const overdue = needs && i.feedbackDueOn && new Date(i.feedbackDueOn) < now
  return { pending: needs, overdue: !!overdue, awaiting: awaiting.map((p) => ({ id: String(p.user), name: p.name })) }
}

function withFeedbackState(i) {
  const json = i.toJSON()
  json.feedbackState = feedbackState(i)
  json.overallRating = averageRating(Object.fromEntries(RATING_KEYS.map((k) => {
    const v = i.scorecards.map((s) => s.ratings?.[k]).filter(Number.isFinite)
    return [k, v.length ? v.reduce((a, b) => a + b, 0) / v.length : null]
  })))
  return json
}

// Validates { interviewerIds } against this company's active members who may give feedback.
async function resolveInterviewers(req, ids) {
  if (!Array.isArray(ids)) return { value: [] }
  const unique = [...new Set(ids.map(String))]
  if (unique.length > 8) return { error: 'Add at most 8 interviewers.' }
  if (!unique.every((id) => mongoose.isValidObjectId(id))) return { error: 'Invalid interviewer.' }
  const users = await User.find({ _id: { $in: unique }, company: req.company._id, status: { $ne: 'disabled' } }).select('name role')
  if (users.length !== unique.length) return { error: 'One or more interviewers are not on your team.' }
  if (users.some((u) => !can(u.role, 'interviews.feedback'))) return { error: 'One or more of those members cannot submit interview feedback.' }
  return { value: users.map((u) => ({ user: u._id, name: u.name })) }
}

function parseDate(v, label) {
  if (v === undefined || v === null || v === '') return { value: null }
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? { error: `${label} is not a valid date.` } : { value: d }
}

export const listInterviews = asyncHandler(async (req, res) => {
  // Interviewers see only the interviews they are on the panel for.
  const query = { company: req.company._id }
  if (!can(req.user.role, 'candidates.view')) query['interviewers.user'] = req.user._id
  const interviews = await Interview.find(query).sort({ startsAt: 1 })
  res.json(interviews.map(withFeedbackState))
})

export const scheduleInterview = asyncHandler(async (req, res) => {
  const { candidateId, role, round, startsAt, durationMins, mode, meetingLink, location, panel, interviewerIds, feedbackDueOn, reminderMinsBefore } = req.body ?? {}
  if (!candidateId || !role || !startsAt || !mode) {
    return res.status(400).json({ message: 'candidateId, role, startsAt and mode are required' })
  }
  const start = parseDate(startsAt, 'Start time')
  if (start.error || !start.value) return res.status(400).json({ message: start.error ?? 'Start time is required' })
  const due = parseDate(feedbackDueOn, 'Feedback deadline')
  if (due.error) return res.status(400).json({ message: due.error })
  if (due.value && due.value < start.value) return res.status(400).json({ message: 'The feedback deadline must be after the interview starts.' })
  const panelResult = await resolveInterviewers(req, interviewerIds)
  if (panelResult.error) return res.status(400).json({ message: panelResult.error })
  let reminderAt = null
  if (reminderMinsBefore !== undefined && reminderMinsBefore !== null && reminderMinsBefore !== '') {
    const mins = Number(reminderMinsBefore)
    if (!Number.isInteger(mins) || mins < 5 || mins > 7 * 24 * 60) return res.status(400).json({ message: 'Reminder must be between 5 minutes and 7 days before.' })
    reminderAt = new Date(start.value.getTime() - mins * 60000)
  }

  const candidate = await Candidate.findOne({ _id: candidateId, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })

  const interview = await Interview.create({
    company: req.company._id,
    candidate: candidate._id,
    candidateName: candidate.name,
    initials: initialsOf(candidate.name),
    role,
    round,
    startsAt,
    durationMins,
    mode,
    meetingLink: mode === 'Video Call' ? meetingLink : null,
    location: mode === 'On-site' ? location : null,
    job: candidate.job ?? null,
    panel: panelResult.value.length ? panelResult.value.map((p) => p.name) : panel,
    interviewers: panelResult.value,
    feedbackDueOn: due.value,
    reminderAt,
    status: 'Confirmed',
  })

  if (candidate.stage === 'shared' || candidate.stage === 'shortlisted') {
    const fromKey = pipelineStageOf(candidate)
    candidate.stage = 'interviewing'
    candidate.stageChangedAt = new Date()
    await candidate.save()
    await recordEvent(req, candidate, 'stage', `Moved from ${STAGE_LABELS[fromKey]} to Interview`, { from: fromKey, to: 'interview' })
    // So the candidate's application tracking moves to "Interview". The notification below already
    // says it better than the generic stage-change one, hence notify: false.
    try {
      await syncApplicationStatusFromStage(candidate, 'interviewing', { notify: false })
    } catch (err) {
      logger.warn({ err }, 'Failed to sync interview stage onto the application')
    }
  }

  await logActivity(req.company._id, `Interview scheduled with ${candidate.name} for ${role}`, 'navy')
  await recordEvent(req, candidate, 'interview', `Interview scheduled for ${start.value.toLocaleString('en-IN')}${round ? ` (${round})` : ''}`)
  await audit(req, 'interview.scheduled', { targetType: 'candidate', targetId: candidate._id, targetLabel: candidate.name, detail: `${role} · ${start.value.toISOString()}` })
  if (candidate.employee) {
    const employee = await Employee.findById(candidate.employee)
    if (employee) {
      await notifyEmployee(employee, {
        category: 'interviews',
        title: 'Interview scheduled',
        body: `${req.company.name} scheduled an interview with you for ${role} on ${new Date(startsAt).toLocaleString('en-IN')}.`,
      })
    }
  }

  // Opt-in: only when the recruiter ticked "email the candidate".
  if (req.body?.notifyByEmail === true) await emailCandidate('scheduled', interview, req)

  res.status(201).json(withFeedbackState(interview))
})

export const rescheduleInterview = asyncHandler(async (req, res) => {
  const { startsAt } = req.body ?? {}
  if (!startsAt) return res.status(400).json({ message: 'startsAt is required' })

  const interview = await Interview.findOneAndUpdate(
    { _id: req.params.id, company: req.company._id },
    { startsAt, status: 'Rescheduled' },
    { new: true }
  )
  if (!interview) return res.status(404).json({ message: 'Interview not found' })

  await notifyCandidateEmployee(interview.candidate, {
    category: 'interviews',
    title: 'Interview rescheduled',
    body: `Your interview for ${interview.role} has been rescheduled to ${new Date(startsAt).toLocaleString('en-IN')}.`,
  })

  if (req.body?.notifyByEmail === true) await emailCandidate('rescheduled', interview, req)

  res.json(interview)
})

export const cancelInterview = asyncHandler(async (req, res) => {
  const interview = await Interview.findOneAndUpdate(
    { _id: req.params.id, company: req.company._id },
    { status: 'Cancelled' },
    { new: true }
  )
  if (!interview) return res.status(404).json({ message: 'Interview not found' })

  await notifyCandidateEmployee(interview.candidate, {
    category: 'interviews',
    title: 'Interview cancelled',
    body: `Your interview for ${interview.role} has been cancelled.`,
  })

  if (req.body?.notifyByEmail === true) await emailCandidate('cancelled', interview, req)

  res.json(interview)
})

export const submitFeedback = asyncHandler(async (req, res) => {
  const { feedback } = req.body ?? {}
  if (!feedback) return res.status(400).json({ message: 'feedback is required' })

  const interview = await Interview.findOneAndUpdate(
    { _id: req.params.id, company: req.company._id },
    { status: 'Completed', feedback },
    { new: true }
  )
  if (!interview) return res.status(404).json({ message: 'Interview not found' })

  await logActivity(req.company._id, `Interview feedback submitted for ${interview.candidateName}`, 'navy')
  await notifyCandidateEmployee(interview.candidate, {
    category: 'interviews',
    title: 'Interview completed',
    body: `Your interview for ${interview.role} has been marked complete.`,
  })

  res.json(interview)
})

// PATCH /interviews/:id/panel { interviewerIds?, feedbackDueOn?, reminderMinsBefore? }
export const updateInterviewPanel = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Interview not found' })
  const interview = await Interview.findOne({ _id: req.params.id, company: req.company._id })
  if (!interview) return res.status(404).json({ message: 'Interview not found' })
  const { interviewerIds, feedbackDueOn, reminderMinsBefore } = req.body ?? {}
  if (interviewerIds !== undefined) {
    const r = await resolveInterviewers(req, interviewerIds)
    if (r.error) return res.status(400).json({ message: r.error })
    interview.interviewers = r.value
    interview.panel = r.value.map((p) => p.name)
  }
  if (feedbackDueOn !== undefined) {
    const d = parseDate(feedbackDueOn, 'Feedback deadline')
    if (d.error) return res.status(400).json({ message: d.error })
    interview.feedbackDueOn = d.value
  }
  if (reminderMinsBefore !== undefined) {
    if (reminderMinsBefore === null || reminderMinsBefore === '') interview.reminderAt = null
    else {
      const mins = Number(reminderMinsBefore)
      if (!Number.isInteger(mins) || mins < 5 || mins > 7 * 24 * 60) return res.status(400).json({ message: 'Reminder must be between 5 minutes and 7 days before.' })
      interview.reminderAt = new Date(new Date(interview.startsAt).getTime() - mins * 60000)
      interview.reminderSentAt = null
    }
  }
  await interview.save()
  res.json(withFeedbackState(interview))
})

// POST /interviews/:id/scorecard — one scorecard per interviewer; resubmitting replaces their own.
export const submitScorecard = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Interview not found' })
  const interview = await Interview.findOne({ _id: req.params.id, company: req.company._id })
  if (!interview) return res.status(404).json({ message: 'Interview not found' })

  const onPanel = interview.interviewers.some((p) => String(p.user) === String(req.user._id))
  // With a named panel only they (or a manager of interviews) may score; with no panel any member who can give feedback may.
  if (interview.interviewers.length && !onPanel && !can(req.user.role, 'interviews.manage')) {
    return res.status(403).json({ code: 'NOT_ON_PANEL', message: 'Only interviewers on this panel can submit a scorecard.' })
  }
  if (interview.status === 'Cancelled') return res.status(409).json({ message: 'This interview was cancelled.' })

  const { ratings, recommendation, comments } = req.body ?? {}
  const errors = {}
  const clean = {}
  for (const key of RATING_KEYS) {
    const v = ratings?.[key]
    if (!Number.isInteger(v) || v < 1 || v > 5) errors[key] = 'Rate from 1 to 5.'
    else clean[key] = v
  }
  if (!RECOMMENDATIONS.includes(recommendation)) errors.recommendation = 'Choose an overall recommendation.'
  const note = String(comments ?? '').trim()
  if (note.length > 2000) errors.comments = 'Keep comments under 2000 characters.'
  if (Object.keys(errors).length) return res.status(400).json({ message: 'Please complete the scorecard.', errors })

  interview.scorecards = interview.scorecards.filter((s) => String(s.interviewer) !== String(req.user._id))
  interview.scorecards.push({ interviewer: req.user._id, interviewerName: req.user.name, ratings: clean, recommendation, comments: note, submittedAt: new Date() })

  const submitted = new Set(interview.scorecards.map((s) => String(s.interviewer)))
  const allIn = interview.interviewers.length ? interview.interviewers.every((p) => submitted.has(String(p.user))) : true
  if (allIn) interview.status = 'Completed'
  await interview.save()

  const candidate = await Candidate.findById(interview.candidate)
  if (candidate) await recordEvent(req, candidate, 'interview', `Scorecard submitted: ${recommendation}`)
  await audit(req, 'interview.scorecard', { targetType: 'interview', targetId: interview._id, targetLabel: interview.candidateName, detail: recommendation })
  res.json(withFeedbackState(interview))
})
