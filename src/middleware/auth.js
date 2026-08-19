import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import User from '../models/User.js'

export const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ message: 'Not authenticated' })

  let payload
  try {
    payload = jwt.verify(token, env.jwtSecret)
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' })
  }
  // Employer and employee tokens are signed with the same secret, so the
  // `type` claim keeps one audience's token from being replayed on the other.
  if (payload.type !== 'employer') return res.status(401).json({ message: 'Invalid or expired token' })

  const user = await User.findById(payload.sub).populate('company')
  if (!user || !user.company) return res.status(401).json({ message: 'User no longer exists' })
  if (user.company.blocked) return res.status(403).json({ message: 'This company account has been blocked. Contact Mzobs support for help.' })

  req.user = user
  req.company = user.company
  next()
})
