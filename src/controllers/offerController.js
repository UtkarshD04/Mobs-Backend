import { asyncHandler } from '../utils/asyncHandler.js'
import { logActivity } from '../utils/activityLog.js'
import { initialsOf } from '../utils/initials.js'
import Offer from '../models/Offer.js'
import Candidate from '../models/Candidate.js'
import Job from '../models/Job.js'

export const listOffers = asyncHandler(async (req, res) => {
  const offers = await Offer.find({ company: req.company._id }).sort({ sentOn: -1 })
  res.json(offers)
})

export const createOffer = asyncHandler(async (req, res) => {
  const { candidateId, role, jobId, ctc, joiningDate, expiresOn } = req.body ?? {}
  if (!candidateId || !role || !jobId || !ctc || !joiningDate || !expiresOn) {
    return res.status(400).json({ message: 'candidateId, role, jobId, ctc, joiningDate and expiresOn are required' })
  }

  const [candidate, job] = await Promise.all([
    Candidate.findOne({ _id: candidateId, company: req.company._id }),
    Job.findOne({ _id: jobId, company: req.company._id }),
  ])
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })
  if (!job) return res.status(404).json({ message: 'Job not found' })

  const offer = await Offer.create({
    company: req.company._id,
    candidate: candidate._id,
    candidateName: candidate.name,
    initials: initialsOf(candidate.name),
    role,
    job: job._id,
    ctc,
    joiningDate,
    status: 'pending',
    sentOn: new Date(),
    expiresOn,
  })

  if (candidate.stage === 'shortlisted' || candidate.stage === 'interviewing') {
    candidate.stage = 'offered'
    await candidate.save()
  }

  await logActivity(req.company._id, `Offer sent to ${candidate.name} for ${role}`, 'gold')

  res.status(201).json(offer)
})

export const updateOfferStatus = asyncHandler(async (req, res) => {
  const { status } = req.body ?? {}
  if (!status) return res.status(400).json({ message: 'status is required' })

  const offer = await Offer.findOne({ _id: req.params.id, company: req.company._id })
  if (!offer) return res.status(404).json({ message: 'Offer not found' })

  offer.status = status
  if (status === 'accepted' || status === 'rejected') offer.respondedOn = new Date()

  await offer.save()

  if (status === 'accepted') await logActivity(req.company._id, `${offer.candidateName} accepted the offer for ${offer.role}`, 'green')

  res.json(offer)
})
