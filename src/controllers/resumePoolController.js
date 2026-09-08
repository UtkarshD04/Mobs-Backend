import { Types } from 'mongoose'
import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Resume from '../models/Resume.js'
import StaffUser from '../models/StaffUser.js'
import StaffNotification from '../models/StaffNotification.js'
import { sendPush } from '../utils/push.js'
import { uploadObject, deleteObject, isS3Configured } from '../utils/s3.js'
import { validateResumeFile, RESUME_POOL_ALLOWED_EXTENSIONS } from '../utils/fileValidation.js'
import { resumePoolKey, buildResumeAccessPath } from '../utils/resumeAccess.js'
import { logger } from '../config/logger.js'

const STATUSES = ['pending', 'verified', 'changes', 'rejected']

// `s3Key` is select:false on the model (never sent to a client raw) — this
// runs on docs fetched with `+s3Key` and swaps it for a fresh, short-lived
// access link instead. Pre-migration rows have a real static `/uploads/...`
// url and no s3Key — left untouched, since express.static still serves it.
function serializePoolResume(doc) {
  const json = doc.toJSON()
  const { s3Key, ...rest } = json
  if (s3Key) rest.url = buildResumeAccessPath(s3Key, rest.file, 'resume-pool')
  return rest
}

export const bulkUpload = asyncHandler(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ message: 'At least one PDF or Word resume file is required' })
  if (!isS3Configured()) return res.status(503).json({ message: 'Resume storage is not configured. Please contact support.' })

  const prepared = []
  const invalid = []
  for (const file of req.files) {
    const result = validateResumeFile(file, { allowedExtensions: RESUME_POOL_ALLOWED_EXTENSIONS })
    if (!result.ok) invalid.push(file.originalname)
    else prepared.push({ _id: new Types.ObjectId(), file, result })
  }
  if (invalid.length) return res.status(400).json({ message: `Unsupported or invalid file(s): ${invalid.join(', ')}` })

  const uploadedKeys = []
  try {
    for (const { _id, file, result } of prepared) {
      const key = resumePoolKey(_id, result.ext)
      await uploadObject({ key, body: file.buffer, contentType: result.mime })
      uploadedKeys.push(key)
    }
  } catch (err) {
    await Promise.all(uploadedKeys.map((key) => deleteObject(key).catch(() => {})))
    logger.error({ err, staffId: String(req.staff._id) }, 'Resume pool bulk upload to S3 failed')
    return res.status(502).json({ message: 'Could not upload resumes right now. Please try again.' })
  }

  const docs = prepared.map(({ _id, file, result }) => ({
    _id,
    file: file.originalname,
    s3Key: resumePoolKey(_id, result.ext),
    uploadedOn: new Date(),
    uploadedBy: req.staff._id,
    status: 'pending',
  }))

  let created
  try {
    created = await Resume.insertMany(docs)
  } catch (err) {
    // DB write failed after the S3 uploads succeeded — clean up the orphaned
    // objects rather than leaving them unreferenced in the bucket.
    await Promise.all(
      uploadedKeys.map((key) => deleteObject(key).catch((cleanupErr) => logger.error({ err: cleanupErr, key }, 'Failed to clean up orphaned resume-pool object after a failed insert')))
    )
    throw err
  }

  await logStaffActivity(`${req.staff.name} bulk-uploaded ${created.length} resume(s) to the pool`, 'navy')

  res.status(201).json({ resumes: created.map(serializePoolResume), count: created.length })
})

export const list = asyncHandler(async (req, res) => {
  const { status, assignedTo, search } = req.query
  const query = {}

  if (req.staff.accessLevel === 'admin') {
    if (assignedTo) query.assignedTo = assignedTo === 'unassigned' ? null : assignedTo
  } else {
    query.assignedTo = req.staff._id
  }

  if (status && status !== 'all') query.status = status
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ name: regex }, { email: regex }, { file: regex }]
  }

  const { data, page, limit, total } = await paginate(Resume, query, paginationParams(req), {
    sort: { uploadedOn: -1 },
    select: '+s3Key',
    populate: ['assignedTo', 'verifiedBy'],
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data.map(serializePoolResume))
})

export const stats = asyncHandler(async (req, res) => {
  const scope = req.staff.accessLevel === 'admin' ? {} : { assignedTo: req.staff._id }

  const byStatus = await Resume.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }])
  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), { total: 0 })
  for (const row of byStatus) {
    counts[row._id] = row.count
    counts.total += row.count
  }

  if (req.staff.accessLevel !== 'admin') return res.json(counts)

  const perStaff = await Resume.aggregate([
    { $match: { assignedTo: { $ne: null } } },
    { $group: { _id: { staff: '$assignedTo', status: '$status' }, count: { $sum: 1 } } },
  ])
  const byStaffMap = new Map()
  for (const row of perStaff) {
    const key = row._id.staff.toString()
    if (!byStaffMap.has(key)) byStaffMap.set(key, STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), { staffId: key, total: 0 }))
    const entry = byStaffMap.get(key)
    entry[row._id.status] = row.count
    entry.total += row.count
  }
  const staffDocs = await StaffUser.find({ _id: { $in: [...byStaffMap.keys()] } }).select('name email')
  const staffLookup = new Map(staffDocs.map((s) => [s._id.toString(), s]))
  const perStaffBreakdown = [...byStaffMap.values()].map((entry) => ({
    ...entry,
    name: staffLookup.get(entry.staffId)?.name ?? 'Unknown',
    email: staffLookup.get(entry.staffId)?.email ?? '',
  }))

  res.json({ ...counts, unassigned: counts.total - perStaffBreakdown.reduce((sum, s) => sum + s.total, 0), perStaff: perStaffBreakdown })
})

async function notifyAssignment(staff, body) {
  const notification = await StaffNotification.create({ staff: staff._id, category: 'resume-pool', title: 'Resume assigned to you', body })
  await sendPush(staff, { title: notification.title, body: notification.body })
}

export const assign = asyncHandler(async (req, res) => {
  const { staffId } = req.body ?? {}
  if (!staffId) return res.status(400).json({ message: 'staffId is required' })

  const staff = await StaffUser.findById(staffId)
  if (!staff) return res.status(404).json({ message: 'Staff account not found' })

  const resume = await Resume.findById(req.params.id).select('+s3Key')
  if (!resume) return res.status(404).json({ message: 'Resume not found' })

  resume.assignedTo = staff._id
  resume.assignedOn = new Date()
  resume.assignedBy = req.staff._id
  await resume.save()

  await logStaffActivity(`${req.staff.name} assigned a resume to ${staff.name}`, 'navy')
  await notifyAssignment(staff, `A resume was assigned to you by ${req.staff.name}.`)

  res.json(serializePoolResume(resume))
})

export const bulkAssign = asyncHandler(async (req, res) => {
  const { resumeIds, staffId } = req.body ?? {}
  if (!Array.isArray(resumeIds) || !resumeIds.length) return res.status(400).json({ message: 'resumeIds must be a non-empty array' })
  if (!staffId) return res.status(400).json({ message: 'staffId is required' })

  const staff = await StaffUser.findById(staffId)
  if (!staff) return res.status(404).json({ message: 'Staff account not found' })

  const result = await Resume.updateMany(
    { _id: { $in: resumeIds } },
    { $set: { assignedTo: staff._id, assignedOn: new Date(), assignedBy: req.staff._id } }
  )

  await logStaffActivity(`${req.staff.name} assigned ${result.modifiedCount} resume(s) to ${staff.name}`, 'navy')
  await notifyAssignment(staff, `${result.modifiedCount} resume(s) were assigned to you by ${req.staff.name}.`)

  res.json({ modifiedCount: result.modifiedCount })
})

export const review = asyncHandler(async (req, res) => {
  const { decision, score, note } = req.body ?? {}
  if (!['verified', 'changes', 'rejected'].includes(decision)) {
    return res.status(400).json({ message: 'decision must be verified, changes or rejected' })
  }

  const resume = await Resume.findById(req.params.id).select('+s3Key')
  if (!resume) return res.status(404).json({ message: 'Resume not found' })

  const isOwner = resume.assignedTo && resume.assignedTo.equals(req.staff._id)
  if (req.staff.accessLevel !== 'admin' && !isOwner) {
    return res.status(403).json({ message: 'This resume is not assigned to you' })
  }

  resume.status = decision
  resume.score = score ?? resume.score
  resume.reviewNote = note ?? ''
  resume.verifiedOn = new Date()
  resume.verifiedBy = req.staff._id
  await resume.save()

  await logStaffActivity(`A resume was marked "${decision}" by ${req.staff.name}`, decision === 'verified' ? 'green' : 'gold')

  res.json(serializePoolResume(resume))
})
