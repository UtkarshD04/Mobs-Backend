import { asyncHandler } from '../utils/asyncHandler.js'
import SupportTicket from '../models/SupportTicket.js'

export const submitTicket = asyncHandler(async (req, res) => {
  const { subject, category, message } = req.body ?? {}
  if (!subject || !message) {
    return res.status(400).json({ message: 'Subject and message are required' })
  }

  const ticket = await SupportTicket.create({
    company: req.company._id,
    user: req.user._id,
    subject,
    category: category ?? 'General',
    message,
  })

  res.status(201).json(ticket)
})
