import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { initialsOf } from '../utils/initials.js'
import StaffUser from '../models/StaffUser.js'

function issueToken(staff) {
  return jwt.sign({ sub: staff._id.toString(), role: staff.role, type: 'staff' }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  })
}

function staffSummary(staff) {
  return {
    id: staff._id.toString(),
    name: staff.name,
    email: staff.email,
    role: staff.role,
    initials: initialsOf(staff.name),
  }
}

// No public signup — staff accounts are provisioned via the seed script or
// by another authenticated staff member through POST /staff/team.
export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ message: 'Email and password are required' })
  }

  const staff = await StaffUser.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash')
  if (!staff) return res.status(401).json({ message: 'Invalid email or password' })

  const matches = await bcrypt.compare(password, staff.passwordHash)
  if (!matches) return res.status(401).json({ message: 'Invalid email or password' })

  staff.lastActiveAt = new Date()
  await staff.save()

  res.json({ token: issueToken(staff), staff: staffSummary(staff) })
})

export const getMe = asyncHandler(async (req, res) => {
  res.json(staffSummary(req.staff))
})
