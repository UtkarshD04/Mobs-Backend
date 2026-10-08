import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
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

  if (status !== undefined) await logStaffActivity(`Campus request ${request.campusName} marked ${STATUS_LABEL[request.status]}`, request.status === 'verified' ? 'green' : 'gold')
  res.json(request)
})
