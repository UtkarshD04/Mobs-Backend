import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import PlanEnquiry, { PLAN_ENQUIRY_STATUSES } from '../models/PlanEnquiry.js'

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const listPlanEnquiries = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const query = {}

  if (typeof status === 'string' && PLAN_ENQUIRY_STATUSES.includes(status)) query.status = status
  if (typeof search === 'string' && search.trim()) {
    const regex = new RegExp(escapeRegex(search.trim()), 'i')
    query.$or = [{ companyName: regex }, { name: regex }, { email: regex }, { phone: regex }]
  }

  const { data, page, limit, total } = await paginate(PlanEnquiry, query, paginationParams(req), { sort: { createdAt: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const planEnquiryStats = asyncHandler(async (_req, res) => {
  const rows = await PlanEnquiry.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  const stats = Object.fromEntries(PLAN_ENQUIRY_STATUSES.map((s) => [s, 0]))
  let total = 0
  for (const r of rows) {
    if (r._id in stats) stats[r._id] = r.count
    total += r.count
  }
  res.json({ ...stats, total })
})

export const updatePlanEnquiry = asyncHandler(async (req, res) => {
  const { status, notes } = req.body ?? {}
  if (status !== undefined && !PLAN_ENQUIRY_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' })
  if (notes !== undefined && typeof notes !== 'string') return res.status(400).json({ message: 'Invalid notes' })

  const enquiry = await PlanEnquiry.findById(req.params.id)
  if (!enquiry) return res.status(404).json({ message: 'Plan enquiry not found' })

  if (status !== undefined) enquiry.status = status
  if (notes !== undefined) enquiry.notes = notes
  enquiry.handledBy = req.staff.name
  enquiry.handledAt = new Date()
  await enquiry.save()

  if (status !== undefined) await logStaffActivity(`Plan enquiry from ${enquiry.companyName} marked ${enquiry.status.toLowerCase()}`, 'gold')
  res.json(enquiry)
})
