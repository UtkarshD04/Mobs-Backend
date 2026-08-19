import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import StaffUser from '../models/StaffUser.js'

export const requireStaffAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ message: 'Not authenticated' })

  let payload
  try {
    payload = jwt.verify(token, env.jwtSecret)
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
  // Employer, employee and staff tokens are all signed with the same secret,
  // so the `type` claim keeps one audience's token from being replayed on another.
  if (payload.type !== 'staff') return res.status(401).json({ message: 'Invalid or expired token' })

  const staff = await StaffUser.findById(payload.sub)
  if (!staff) return res.status(401).json({ message: 'Staff account no longer exists' })

  req.staff = staff
  next()
})
