import { asyncHandler } from '../utils/asyncHandler.js'
import { logActivity } from '../utils/activityLog.js'
import { initialsOf } from '../utils/initials.js'
import Interview from '../models/Interview.js'
import Candidate from '../models/Candidate.js'

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
  }

  await logActivity(req.company._id, `Interview scheduled with ${candidate.name} for ${role}`, 'navy')

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
  res.json(interview)
})

export const cancelInterview = asyncHandler(async (req, res) => {
  const interview = await Interview.findOneAndUpdate(
    { _id: req.params.id, company: req.company._id },
    { status: 'Cancelled' },
    { new: true }
  )
  if (!interview) return res.status(404).json({ message: 'Interview not found' })
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

  res.json(interview)
})
