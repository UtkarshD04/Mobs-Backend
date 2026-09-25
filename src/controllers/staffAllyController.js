import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import AllyApplication, { ALLY_STATUSES } from '../models/AllyApplication.js'

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const listApplications = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const query = {}

  if (typeof status === 'string' && ALLY_STATUSES.includes(status)) query.status = status
  if (typeof search === 'string' && search.trim()) {
    const regex = new RegExp(escapeRegex(search.trim()), 'i')
    query.$or = [{ name: regex }, { email: regex }, { college: regex }, { city: regex }, { phone: regex }]
  }

  const { data, page, limit, total } = await paginate(AllyApplication, query, paginationParams(req), { sort: { createdAt: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const allyStats = asyncHandler(async (_req, res) => {
  const rows = await AllyApplication.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  const stats = Object.fromEntries(ALLY_STATUSES.map((s) => [s, 0]))
  let total = 0
  for (const r of rows) {
    if (r._id in stats) stats[r._id] = r.count
    total += r.count
  }
  res.json({ ...stats, total })
})

export const updateApplication = asyncHandler(async (req, res) => {
  const { status, notes } = req.body ?? {}
  if (status !== undefined && !ALLY_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' })
  if (notes !== undefined && typeof notes !== 'string') return res.status(400).json({ message: 'Invalid notes' })

  const application = await AllyApplication.findById(req.params.id)
  if (!application) return res.status(404).json({ message: 'Application not found' })

  if (status !== undefined) application.status = status
  if (notes !== undefined) application.notes = notes
  application.reviewedBy = req.staff.name
  application.reviewedAt = new Date()
  await application.save()

  if (status !== undefined) {
    await logStaffActivity(`Mzobs Ally application from ${application.name} marked ${application.status.toLowerCase()}`, application.status === 'Selected' ? 'green' : 'gold')
  }
  res.json(application)
})
