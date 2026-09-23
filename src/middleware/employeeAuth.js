import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import Employee from '../models/Employee.js'

export const requireEmployeeAuth = asyncHandler(async (req, res, next) => {
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
  if (payload.type !== 'employee') return res.status(401).json({ message: 'Invalid or expired token' })

  // resume.s3Key/resumeHistory.s3Key/passwordHash are select:false by default
  // (never sent to a client raw) — explicitly pulled in here since profile
  // needs resume keys to mint an access link, and passwordHash's mere
  // presence (never its value) to tell the client whether a password is set.
  const employee = await Employee.findById(payload.sub).select('+resume.s3Key +resumeHistory.s3Key +passwordHash')
  if (!employee) return res.status(401).json({ message: 'Employee no longer exists' })
  if (employee.status === 'suspended') return res.status(403).json({ message: 'This account has been suspended. Contact Mzobs support for help.' })

  req.employee = employee
  next()
})
