import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import { logger } from '../config/logger.js'
import { sendMail } from '../utils/mailer.js'
import { nextSequence } from '../models/Counter.js'
import { formatCampusCode, CAMPUS_CODE_COUNTER } from '../utils/campusCode.js'
import { campusVerifiedEmail } from '../utils/campusVerifiedEmail.js'
import CampusRequest, { CAMPUS_REQUEST_STATUSES } from '../models/CampusRequest.js'

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const STATUS_LABEL = { pending: 'pending', under_review: 'under review', verified: 'verified', rejected: 'rejected' }

export const listCampusRequests = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const query = {}

  if (typeof status === 'string' && CAMPUS_REQUEST_STATUSES.includes(status)) query.status = status
  if (typeof search === 'string' && search.trim()) {
    const regex = new RegExp(escapeRegex(search.trim()), 'i')
    query.$or = [{ campusName: regex }, { contactPerson: regex }, { officialEmail: regex }, { city: regex }, { state: regex }, { phone: regex }]
  }

  const { data, page, limit, total } = await paginate(CampusRequest, query, paginationParams(req), { sort: { createdAt: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const campusRequestStats = asyncHandler(async (_req, res) => {
  const rows = await CampusRequest.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  const stats = Object.fromEntries(CAMPUS_REQUEST_STATUSES.map((s) => [s, 0]))
  let total = 0
  for (const r of rows) {
    if (r._id in stats) stats[r._id] = r.count
    total += r.count
  }
  res.json({ ...stats, total })
})

export const updateCampusRequest = asyncHandler(async (req, res) => {
  const { status, notes } = req.body ?? {}
  if (status !== undefined && !CAMPUS_REQUEST_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' })
  if (notes !== undefined && typeof notes !== 'string') return res.status(400).json({ message: 'Invalid notes' })

  const request = await CampusRequest.findById(req.params.id)
  if (!request) return res.status(404).json({ message: 'Campus request not found' })

  if (status !== undefined) request.status = status
  if (notes !== undefined) request.notes = notes
  request.reviewedBy = req.staff.name
  request.reviewedAt = new Date()
  await request.save()

  // The campus code (MZOBS1201, MZOBS1202 …) is issued the first time a campus is verified, and only once.
  // The conditional update means that if two staff members verify at the same moment, one code wins.
  let issued = false
  if (request.status === 'verified' && !request.campusCode) {
    const code = formatCampusCode(await nextSequence(CAMPUS_CODE_COUNTER))
    const claimed = await CampusRequest.updateOne({ _id: request._id, campusCode: { $exists: false } }, { $set: { campusCode: code, codeIssuedOn: new Date() } })
    issued = claimed.modifiedCount === 1
  }

  // Re-read so the response always carries the stored code, even when another request won the race.
  const fresh = await CampusRequest.findById(request._id)

  if (issued) {
    await logStaffActivity(`Campus ${fresh.campusName} verified — code ${fresh.campusCode}`, 'green')
    // Best effort: a mail problem must never undo or hide the verification itself.
    try {
      await sendMail({ to: fresh.officialEmail, ...campusVerifiedEmail({ contactPerson: fresh.contactPerson, campusName: fresh.campusName, code: fresh.campusCode }) })
    } catch (err) {
      logger.warn({ err, campusRequest: fresh.id }, 'Failed to send campus verified email')
    }
  } else if (status !== undefined) {
    await logStaffActivity(`Campus request ${fresh.campusName} marked ${STATUS_LABEL[fresh.status]}`, fresh.status === 'verified' ? 'green' : 'gold')
  }
  res.json(fresh)
})
