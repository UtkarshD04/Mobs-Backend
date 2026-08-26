import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import SupportTicket from '../models/SupportTicket.js'

export const listTickets = asyncHandler(async (req, res) => {
  const { status, source, category, search } = req.query
  const query = {}

  if (status && status !== 'all') query.status = status
  if (source && source !== 'all') query.source = source
  if (category && category !== 'all') query.category = category
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ subject: regex }, { message: regex }]
  }

  const { data, page, limit, total } = await paginate(SupportTicket, query, paginationParams(req), {
    sort: { createdAt: -1 },
    populate: [
      { path: 'company', select: 'name' },
      { path: 'user', select: 'name email' },
      { path: 'employee', select: 'name email' },
    ],
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const respondTicket = asyncHandler(async (req, res) => {
  const { status, reply } = req.body ?? {}
  const ticket = await SupportTicket.findById(req.params.id)
  if (!ticket) return res.status(404).json({ message: 'Query not found' })

  if (status) ticket.status = status
  if (reply != null) ticket.reply = reply
  if (reply) {
    ticket.respondedBy = req.staff.name
    ticket.respondedAt = new Date()
  }

  await ticket.save()
  await logStaffActivity(`Query "${ticket.subject}" marked ${ticket.status.toLowerCase()}`, ticket.status === 'Resolved' ? 'green' : 'gold')

  res.json(ticket)
})
