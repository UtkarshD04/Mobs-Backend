import mongoose from 'mongoose'
import { asyncHandler } from '../utils/asyncHandler.js'
import { audit } from '../utils/audit.js'
import { logActivity } from '../utils/activityLog.js'
import { notifyEmployer } from '../utils/notifyEmployer.js'
import { notifyStaff } from '../utils/notifyStaff.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { logger } from '../config/logger.js'
import ManagedShortlistRequest, { MANAGED_STATUSES, MANAGED_URGENCY, OPEN_MANAGED_STATUSES } from '../models/ManagedShortlistRequest.js'
import Job from '../models/Job.js'
import Candidate from '../models/Candidate.js'
import StaffUser from '../models/StaffUser.js'

const isId = (v) => mongoose.isValidObjectId(v)
const PROFILE_MIN = 20
const PROFILE_MAX = 2000
const NOTES_MAX = 1000

// Statuses only move forward (or to closed); skipping ahead is allowed so Ops can share a shortlist without clicking through each step.
const RANK = Object.fromEntries(MANAGED_STATUSES.map((s, i) => [s, i]))
export const canMoveManaged = (from, to) => from !== 'closed' && (to === 'closed' || RANK[to] > RANK[from])

// What the employer is allowed to see: never the staff note or who internally owns it beyond a name.
async function toEmployerView(req, row) {
  const shared = row.sharedCandidates?.length ? await Candidate.find({ _id: { $in: row.sharedCandidates }, company: req.company._id }).select('name headline experienceYears location') : []
  return {
    id: row.id,
    jobId: String(row.job?._id ?? row.job),
    jobTitle: row.job?.title,
    urgency: row.urgency,
    idealProfile: row.idealProfile,
    notes: row.notes,
    status: row.status,
    history: row.statusHistory.map((h) => ({ status: h.status, at: h.at })),
    requestedByName: row.requestedByName,
    createdAt: row.createdAt,
    assignedTo: row.assignedTo || null,
    shortlistMessage: row.status === 'shortlist_shared' || row.status === 'closed' ? row.shortlistMessage : '',
    sharedOn: row.sharedOn,
    sharedCandidates: shared.map((c) => ({ id: c.id, name: c.name, headline: c.headline, experienceYears: c.experienceYears, location: c.location })),
  }
}

export const listManagedRequests = asyncHandler(async (req, res) => {
  const query = { company: req.company._id }
  if (req.query.jobId) {
    if (!isId(req.query.jobId)) return res.status(400).json({ message: 'Invalid jobId' })
    query.job = req.query.jobId
  }
  const rows = await ManagedShortlistRequest.find(query).sort({ createdAt: -1 }).limit(100).populate('job', 'title')
  res.json(await Promise.all(rows.map((r) => toEmployerView(req, r))))
})

export const createManagedRequest = asyncHandler(async (req, res) => {
  const { jobId, urgency = 'standard', idealProfile, notes = '' } = req.body ?? {}
  const errors = {}
  if (!isId(jobId)) errors.jobId = 'Choose a job.'
  if (!MANAGED_URGENCY.includes(urgency)) errors.urgency = 'Choose how urgent this is.'
  const profile = String(idealProfile ?? '').trim()
  if (profile.length < PROFILE_MIN) errors.idealProfile = `Describe the ideal candidate (at least ${PROFILE_MIN} characters).`
  else if (profile.length > PROFILE_MAX) errors.idealProfile = `Keep this under ${PROFILE_MAX} characters.`
  const extra = String(notes ?? '').trim()
  if (extra.length > NOTES_MAX) errors.notes = `Keep notes under ${NOTES_MAX} characters.`
  if (Object.keys(errors).length) return res.status(400).json({ message: 'Please fix the highlighted fields.', errors })

  const job = await Job.findOne({ _id: jobId, company: req.company._id }).select('title status')
  if (!job) return res.status(404).json({ message: 'Job not found' })
  if (['draft', 'archived'].includes(job.status)) return res.status(409).json({ message: 'Publish this job before asking MZOBS to shortlist for it.' })
  if (await ManagedShortlistRequest.exists({ company: req.company._id, job: job._id, status: { $in: OPEN_MANAGED_STATUSES } })) {
    return res.status(409).json({ code: 'REQUEST_OPEN', message: 'There is already an open shortlisting request for this job.' })
  }

  const row = await ManagedShortlistRequest.create({
    company: req.company._id,
    job: job._id,
    requestedBy: req.user._id,
    requestedByName: req.user.name,
    urgency,
    idealProfile: profile,
    notes: extra,
    statusHistory: [{ status: 'requested', by: req.user.name }],
  })

  try {
    const admins = await StaffUser.find({ accessLevel: 'admin', status: { $ne: 'disabled' } }).select('_id')
    await Promise.all(admins.map((s) => notifyStaff(s, { category: 'system', title: `Shortlisting request${urgency === 'urgent' ? ' (urgent)' : ''}`, body: `${req.company.name} asked for help shortlisting for ${job.title}.` })))
  } catch (err) {
    logger.warn({ err }, 'Failed to notify staff of a managed shortlist request')
  }
  await logActivity(req.company._id, `Requested MZOBS shortlisting for "${job.title}"`, 'gold')
  await audit(req, 'support.requested', { targetType: 'job', targetId: job._id, targetLabel: job.title, detail: `urgency: ${urgency}` })
  row.job = job
  res.status(201).json(await toEmployerView(req, row))
})

export const closeManagedRequest = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: 'Request not found' })
  const row = await ManagedShortlistRequest.findOne({ _id: req.params.id, company: req.company._id }).populate('job', 'title')
  if (!row) return res.status(404).json({ message: 'Request not found' })
  if (row.status === 'closed') return res.status(409).json({ message: 'This request is already closed.' })
  row.status = 'closed'
  row.statusHistory.push({ status: 'closed', by: req.user.name })
  await row.save()
  res.json(await toEmployerView(req, row))
})

// ---- MZOBS operations (staff) ------------------------------------------------------------------------------------

export const staffListManaged = asyncHandler(async (req, res) => {
  const query = {}
  if (req.query.status && req.query.status !== 'all') {
    if (!MANAGED_STATUSES.includes(req.query.status)) return res.status(400).json({ message: 'Unknown status' })
    query.status = req.query.status
  }
  const rows = await ManagedShortlistRequest.find(query).sort({ createdAt: -1 }).limit(200).select('+staffNote').populate('company', 'name').populate('job', 'title skills location experienceMin experienceMax')
  res.json(
    rows.map((r) => ({
      id: r.id,
      company: r.company?.name,
      companyId: String(r.company?._id),
      job: r.job ? { id: String(r.job._id), title: r.job.title, skills: r.job.skills, location: r.job.location, experienceMin: r.job.experienceMin, experienceMax: r.job.experienceMax } : null,
      urgency: r.urgency,
      idealProfile: r.idealProfile,
      notes: r.notes,
      status: r.status,
      history: r.statusHistory,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt,
      assignedTo: r.assignedTo,
      staffNote: r.staffNote,
      shortlistMessage: r.shortlistMessage,
      sharedCandidateIds: r.sharedCandidates.map(String),
    }))
  )
})

// GET /staff/managed-shortlists/:id/candidates — the company's applicants for this job, for building the shortlist.
// Profile facts only: no contact details, resume or private notes.
export const staffManagedCandidates = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: 'Request not found' })
  const row = await ManagedShortlistRequest.findById(req.params.id).select('company job')
  if (!row) return res.status(404).json({ message: 'Request not found' })
  const list = await Candidate.find({ company: row.company, job: row.job, stage: { $ne: 'rejected' } }).sort({ sharedOn: -1 }).limit(300).select('name headline experienceYears location skills stage expectedSalary availability')
  res.json(list.map((c) => ({ id: c.id, name: c.name, headline: c.headline, experienceYears: c.experienceYears, location: c.location, skills: c.skills, stage: c.stage, expectedSalary: c.expectedSalary, availability: c.availability })))
})

// PATCH /staff/managed-shortlists/:id { status?, assignedTo?, staffNote?, shortlistMessage?, candidateIds? }
export const staffUpdateManaged = asyncHandler(async (req, res) => {
  if (!isId(req.params.id)) return res.status(404).json({ message: 'Request not found' })
  const row = await ManagedShortlistRequest.findById(req.params.id).select('+staffNote').populate('job', 'title')
  if (!row) return res.status(404).json({ message: 'Request not found' })
  const { status, assignedTo, staffNote, shortlistMessage, candidateIds } = req.body ?? {}

  if (assignedTo !== undefined) row.assignedTo = String(assignedTo ?? '').trim().slice(0, 80)
  if (staffNote !== undefined) row.staffNote = String(staffNote ?? '').trim().slice(0, 2000)
  if (shortlistMessage !== undefined) row.shortlistMessage = String(shortlistMessage ?? '').trim().slice(0, 2000)

  let sharing = false
  if (candidateIds !== undefined) {
    if (!Array.isArray(candidateIds) || !candidateIds.every(isId) || candidateIds.length > 50) return res.status(400).json({ message: 'candidateIds must be a list of up to 50 candidate ids.' })
    // Only this company's candidates for this job can be put on its shortlist.
    const found = await Candidate.find({ _id: { $in: candidateIds }, company: row.company, job: row.job._id }).select('_id tags')
    if (found.length !== new Set(candidateIds.map(String)).size) return res.status(400).json({ message: 'Some candidates do not belong to this company’s job.' })
    row.sharedCandidates = found.map((c) => c._id)
  }

  if (status !== undefined) {
    if (!MANAGED_STATUSES.includes(status)) return res.status(400).json({ message: 'Unknown status' })
    if (status !== row.status) {
      if (!canMoveManaged(row.status, status)) return res.status(409).json({ message: `Cannot move from ${row.status} to ${status}.` })
      if (status === 'shortlist_shared') {
        if (!row.sharedCandidates.length) return res.status(400).json({ message: 'Add at least one candidate before sharing the shortlist.' })
        if (!row.shortlistMessage) return res.status(400).json({ message: 'Add a short message to the employer with the shortlist.' })
        row.sharedOn = new Date()
        sharing = true
      }
      row.status = status
      row.statusHistory.push({ status, by: req.staff.name })
    }
  }
  await row.save()

  if (sharing) {
    // Tag (never move) the candidates so the employer can filter the pipeline to what MZOBS picked.
    await Candidate.updateMany({ _id: { $in: row.sharedCandidates }, company: row.company }, { $addToSet: { tags: 'MZOBS shortlist' } })
  }
  if (status !== undefined) {
    const label = { in_review: 'is being reviewed', shortlisting: 'is now being shortlisted', shortlist_shared: 'has a shortlist ready', closed: 'has been closed' }[row.status]
    if (label) {
      try {
        await notifyEmployer({ _id: row.company }, { category: 'candidates', title: 'MZOBS shortlisting update', body: `Your shortlisting request for ${row.job?.title ?? 'a job'} ${label}.` })
      } catch (err) {
        logger.warn({ err }, 'Failed to notify employer about shortlisting progress')
      }
    }
  }
  await logStaffActivity(`${req.staff.name} updated a shortlisting request for ${row.job?.title ?? 'a job'} (${row.status})`)
  res.json({ ok: true, status: row.status })
})
