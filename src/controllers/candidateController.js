import { asyncHandler } from '../utils/asyncHandler.js'
import { logActivity } from '../utils/activityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Candidate from '../models/Candidate.js'
import Batch from '../models/Batch.js'

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
  res.json(data)
})

export const getCandidate = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })
  res.json(candidate)
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

  res.json(candidate)
})
