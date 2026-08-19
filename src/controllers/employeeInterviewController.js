import { asyncHandler } from '../utils/asyncHandler.js'
import Interview from '../models/Interview.js'
import Candidate from '../models/Candidate.js'

function publicInterview(interview) {
  const candidate = interview.candidate
  const company = candidate?.company
  return {
    id: interview._id.toString(),
    company: company?.name ?? '',
    logo: company?.logo ?? '',
    role: interview.role,
    round: interview.round,
    when: interview.startsAt,
    duration: interview.durationMins,
    mode: interview.mode,
    link: interview.meetingLink,
    location: interview.location,
    status: interview.status,
    sharedOn: candidate?.sharedOn ?? interview.createdAt,
  }
}

export const listInterviews = asyncHandler(async (req, res) => {
  const candidateIds = await Candidate.find({ employee: req.employee._id }).distinct('_id')
  if (candidateIds.length === 0) return res.json([])

  const interviews = await Interview.find({ candidate: { $in: candidateIds } })
    .populate({ path: 'candidate', select: 'company sharedOn', populate: { path: 'company', select: 'name logo' } })
    .sort({ startsAt: 1 })

  res.json(interviews.map(publicInterview))
})
