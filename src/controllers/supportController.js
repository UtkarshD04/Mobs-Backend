import { asyncHandler } from '../utils/asyncHandler.js'
import SupportTicket from '../models/SupportTicket.js'

export const submitTicket = asyncHandler(async (req, res) => {
  const { subject, category, message } = req.body ?? {}
  if (!subject || !message) {
    return res.status(400).json({ message: 'Subject and message are required' })
  }

  const ticket = await SupportTicket.create({
    source: 'employer',
    company: req.company._id,
    user: req.user._id,
    subject,
    category: category ?? 'General',
    message,
  })

  res.status(201).json(ticket)
})

export const submitEmployeeTicket = asyncHandler(async (req, res) => {
  const { subject, category, message } = req.body ?? {}
  if (!subject || !message) {
    return res.status(400).json({ message: 'Subject and message are required' })
  }

  const ticket = await SupportTicket.create({
    source: 'employee',
    employee: req.employee._id,
    subject,
    category: category ?? 'General',
    message,
  })

  res.status(201).json(ticket)
})

export const listMyTickets = asyncHandler(async (req, res) => {
  const tickets = await SupportTicket.find({ source: 'employee', employee: req.employee._id }).sort({ createdAt: -1 })
  res.json(tickets)
})
