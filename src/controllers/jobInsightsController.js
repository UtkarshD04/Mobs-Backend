import mongoose from 'mongoose'
import { asyncHandler } from '../utils/asyncHandler.js'
import { requirementMatch, STAGE_LABELS } from '../utils/pipeline.js'
import Job from '../models/Job.js'
import Candidate from '../models/Candidate.js'
import CandidateEvent from '../models/CandidateEvent.js'
import Interview from '../models/Interview.js'
import Offer from '../models/Offer.js'

const DAY = 86400000
const ADVANCED = ['shortlisted', 'interviewing', 'offered', 'hired']
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null)

// GET /jobs/:id/insights — only figures that exist in the stored data. Where a figure cannot be known it is null and
// the UI says so; nothing is estimated.
export const getJobInsights = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Job not found' })
  const job = await Job.findOne({ _id: req.params.id, company: req.company._id })
  if (!job) return res.status(404).json({ message: 'Job not found' })

  const candidates = await Candidate.find({ company: req.company._id, job: job._id }).select('stage reviewedAt sharedOn skills experienceYears location expectedSalary source')
  const ids = candidates.map((c) => c._id)
  const [events, interviews, offers] = await Promise.all([
    CandidateEvent.find({ company: req.company._id, job: job._id, type: { $in: ['stage', 'reject'] } }).sort({ createdAt: 1 }).select('candidate type meta createdAt'),
    Interview.find({ company: req.company._id, candidate: { $in: ids }, status: { $ne: 'Cancelled' } }).select('candidate'),
    Offer.find({ company: req.company._id, job: job._id }).select('candidate'),
  ])

  const total = candidates.length
  const candidateIds = new Set(ids.map(String))

  // Qualified: has at least half of the skills the job lists and is not under the experience range. Not computable without listed skills.
  const hasSkills = (job.skills ?? []).length > 0
  const qualified = hasSkills
    ? candidates.filter((c) => {
        const m = requirementMatch(c, job)
        return m.matchedSkills.length * 2 >= m.requiredSkills && m.experience !== 'below'
      }).length
    : null

  // "Ever shortlisted" = currently at/after shortlist, or a recorded move into it.
  const everAdvanced = new Set(candidates.filter((c) => ADVANCED.includes(c.stage)).map((c) => String(c._id)))
  for (const e of events) if (e.type === 'stage' && ['shortlisted', 'interview', 'offer', 'hired'].includes(e.meta?.to)) everAdvanced.add(String(e.candidate))
  const interviewed = new Set(interviews.map((i) => String(i.candidate)).filter((id) => candidateIds.has(id)))
  const offered = new Set(offers.map((o) => String(o.candidate)).filter((id) => candidateIds.has(id)))
  for (const c of candidates) if (['offered', 'hired'].includes(c.stage)) offered.add(String(c._id))

  // Time in stage: completed stints only, from recorded moves. People moved before moves were recorded have no stints, so
  // `samples` is shown beside every average.
  const stints = new Map()
  const byCandidate = new Map()
  for (const e of events) if (e.type === 'stage' && e.meta?.from && e.meta?.to) (byCandidate.get(String(e.candidate)) ?? byCandidate.set(String(e.candidate), []).get(String(e.candidate))).push(e)
  const sharedOn = new Map(candidates.map((c) => [String(c._id), c.sharedOn]))
  for (const [cid, list] of byCandidate) {
    let enteredAt = sharedOn.get(cid)
    let prevTo = null
    list.forEach((e, idx) => {
      // Entered the first recorded "from" stage at share time only if that move is the candidate's first recorded one and from === 'new'.
      const from = e.meta.from
      const start = idx === 0 ? (from === 'new' ? enteredAt : null) : prevTo === from ? enteredAt : null
      if (start) {
        const days = (e.createdAt - start) / DAY
        const bucket = stints.get(from) ?? []
        bucket.push(days)
        stints.set(from, bucket)
      }
      enteredAt = e.createdAt
      prevTo = e.meta.to
    })
  }
  const timeInStage = Object.keys(STAGE_LABELS).map((key) => {
    const v = stints.get(key) ?? []
    return { stage: key, label: STAGE_LABELS[key], avgDays: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null, samples: v.length }
  })

  const bySource = {}
  for (const c of candidates) bySource[c.source || 'Unknown'] = (bySource[c.source || 'Unknown'] ?? 0) + 1

  const stageCounts = Object.fromEntries(Object.keys(STAGE_LABELS).map((k) => [k, 0]))
  for (const c of candidates) {
    const key = c.stage === 'shared' ? (c.reviewedAt ? 'reviewed' : 'new') : c.stage === 'interviewing' ? 'interview' : c.stage === 'offered' ? 'offer' : c.stage
    stageCounts[key] += 1
  }

  res.json({
    jobId: job.id,
    views: { count: job.viewCount ?? 0, since: job.viewsTrackedSince ?? null },
    applications: total,
    qualified: { count: qualified, rule: 'Has at least half of the skills listed on the job and is not below its experience range.' },
    shortlisted: everAdvanced.size,
    interviewConversion: { numerator: interviewed.size, denominator: everAdvanced.size, percent: pct(interviewed.size, everAdvanced.size) },
    offerConversion: { numerator: offered.size, denominator: interviewed.size, percent: pct(offered.size, interviewed.size) },
    stageCounts,
    timeInStage,
    sources: Object.entries(bySource).map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
  })
})
