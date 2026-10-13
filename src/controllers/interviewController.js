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

export const listInterviews = asyncHandler(async (req, res) => {
  const interviews = await Interview.find({ company: req.company._id }).sort({ startsAt: 1 })
  res.json(interviews)
})

export const scheduleInterview = asyncHandler(async (req, res) => {
  const { candidateId, role, round, startsAt, durationMins, mode, meetingLink, location, panel } = req.body ?? {}
  if (!candidateId || !role || !startsAt || !mode) {
    return res.status(400).json({ message: 'candidateId, role, startsAt and mode are required' })
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
    panel,
    status: 'Confirmed',
  })

  if (candidate.stage === 'shared' || candidate.stage === 'shortlisted') {
    candidate.stage = 'interviewing'
    await candidate.save()
    // So the candidate's application tracking moves to "Interview". The notification below already
    // says it better than the generic stage-change one, hence notify: false.
    try {
      await syncApplicationStatusFromStage(candidate, 'interviewing', { notify: false })
    } catch (err) {
      logger.warn({ err }, 'Failed to sync interview stage onto the application')
    }
  }

  await logActivity(req.company._id, `Interview scheduled with ${candidate.name} for ${role}`, 'navy')
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

  res.status(201).json(interview)
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
