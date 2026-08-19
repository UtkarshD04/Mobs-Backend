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

  const employee = await Employee.findById(payload.sub)
  if (!employee) return res.status(401).json({ message: 'Employee no longer exists' })

  req.employee = employee
  next()
})
