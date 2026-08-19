import { asyncHandler } from '../utils/asyncHandler.js'
import ContactMessage from '../models/ContactMessage.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ROLES = ['Job Seeker', 'Employer', 'Other']

export const submitContactMessage = asyncHandler(async (req, res) => {
  const { name, email, role, subject, message } = req.body ?? {}

  const required = { name, email, subject, message }
  if (Object.values(required).some((v) => typeof v !== 'string' || !v.trim())) {
    return res.status(400).json({ message: 'Name, email, subject and message are required' })
  }
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ message: 'Enter a valid email address' })
  }

  const contactMessage = await ContactMessage.create({
    name: name.trim(),
    email: email.trim(),
    role: ROLES.includes(role) ? role : 'Other',
    subject: subject.trim(),
    message: message.trim(),
  })

  res.status(201).json({ id: contactMessage.id })
})
