import { asyncHandler } from '../utils/asyncHandler.js'
import { logActivity } from '../utils/activityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Candidate from '../models/Candidate.js'
import Batch from '../models/Batch.js'
import Employee from '../models/Employee.js'
import { buildResumeAccessPath } from '../utils/resumeAccess.js'

// The candidate's resume file lives only on the linked Employee record
// (candidateSchema.employee) — it is never copied/duplicated onto the
// Candidate doc itself. This resolves that link to a fresh, short-lived
// access URL rather than storing (and inevitably going stale on) a static
// one. Employer access is authorized by the Candidate lookup already being
// scoped to `company: req.company._id` in every caller below — an employer
// can only ever reach candidates explicitly shared with their own company,
// so this can't be used to fetch an arbitrary employee's resume by guessing
// a candidateId.
async function attachResumeUrls(candidates) {
  const isList = Array.isArray(candidates)
  const list = isList ? candidates : [candidates]

  const employeeIds = list.map((c) => c.employee).filter(Boolean)
  const employeeById = new Map()
  if (employeeIds.length) {
    const employees = await Employee.find({ _id: { $in: employeeIds } }).select('resume.status resume.file resume.url +resume.s3Key')
    for (const e of employees) employeeById.set(String(e._id), e)
  }

  const withUrl = list.map((candidate) => {
    const json = candidate.toJSON()
    const employee = candidate.employee ? employeeById.get(String(candidate.employee)) : null
    const resume = employee?.resume
    json.resumeUrl =
      resume?.status === 'verified'
        ? resume.s3Key
          ? buildResumeAccessPath(resume.s3Key, resume.file, 'employer-resume')
          : (resume.url ?? null) // pre-migration resume: legacy static /uploads/... path, still served as-is
        : null
    return json
  })

  return isList ? withUrl : withUrl[0]
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
  res.json(await attachResumeUrls(data))
})

export const getCandidate = asyncHandler(async (req, res) => {
  const candidate = await Candidate.findOne({ _id: req.params.id, company: req.company._id })
  if (!candidate) return res.status(404).json({ message: 'Candidate not found' })
  res.json(await attachResumeUrls(candidate))
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

  res.json(await attachResumeUrls(candidate))
})
