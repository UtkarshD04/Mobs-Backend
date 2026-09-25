import { asyncHandler } from '../utils/asyncHandler.js'
import AllyApplication from '../models/AllyApplication.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Public — the Mzobs Ally application form on the landing site.
export const submitApplication = asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  const str = (v) => (typeof v === 'string' ? v.trim() : '')
  const data = {
    name: str(b.name),
    email: str(b.email),
    phone: str(b.phone),
    college: str(b.college),
    city: str(b.city),
    course: str(b.course),
    experience: str(b.experience),
    involvement: str(b.involvement),
    why: str(b.why),
  }

  const missing = ['name', 'email', 'college', 'city', 'course', 'experience', 'why'].filter((k) => !data[k])
  if (missing.length) return res.status(400).json({ message: 'Please fill in all the required fields' })
  if (!EMAIL_RE.test(data.email)) return res.status(400).json({ message: 'Enter a valid email address' })
  if (data.phone && data.phone.replace(/\D/g, '').length < 10) return res.status(400).json({ message: 'Enter a 10-digit phone number' })

  const application = await AllyApplication.create(data)
  res.status(201).json({ id: application.id })
})
