import { asyncHandler } from '../utils/asyncHandler.js'
import Candidate from '../models/Candidate.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import Employee from '../models/Employee.js'
import { performOutreach } from '../utils/outreach.js'

// POST /api/employer/candidates/:id/outreach — email or text a candidate from
// the portal. Needs the matching part revealed first (see utils/outreach.js).
export const sendOutreach = asyncHandler(async (req, res) => {
  const { channel, subject, body } = req.body ?? {}
  if (channel !== 'email' && channel !== 'sms') return res.status(400).json({ message: 'channel must be email or sms' })

  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })

  const [unlock, employee] = await Promise.all([
    CandidateUnlock.findOne({ company: req.company._id, candidate: candidate._id }),
    candidate.employee ? Employee.findById(candidate.employee).select('name email phone') : null,
  ])

  const { status, json } = await performOutreach({ company: req.company, user: req.user, candidate, employee, unlock, channel, subject, body })
  res.status(status).json(json)
})
