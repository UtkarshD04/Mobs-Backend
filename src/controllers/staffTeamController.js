import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import StaffUser from '../models/StaffUser.js'

const ROLES = ['Operations Manager', 'Resume Verification Lead', 'Interview Panel', 'Employer Success', 'Compliance & KYC']

export const listTeam = asyncHandler(async (req, res) => {
  const { data, page, limit, total } = await paginate(StaffUser, {}, paginationParams(req), { sort: { createdAt: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

// No email-invite flow yet — an authenticated staff member provisions a
// teammate directly with a generated temporary password.
export const createTeammate = asyncHandler(async (req, res) => {
  const { name, email, role } = req.body ?? {}
  if (!name || !email || !role) return res.status(400).json({ message: 'name, email and role are required' })
  if (!ROLES.includes(role)) return res.status(400).json({ message: 'Invalid role' })

  const normalizedEmail = email.toLowerCase().trim()
  const existing = await StaffUser.findOne({ email: normalizedEmail })
  if (existing) return res.status(409).json({ message: 'A staff account with this email already exists' })

  const tempPassword = crypto.randomBytes(9).toString('base64url')
  const passwordHash = await bcrypt.hash(tempPassword, 10)

  const staff = await StaffUser.create({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    role,
    status: 'invited',
  })

  await logStaffActivity(`${req.staff.name} added ${staff.name} to the team as ${role}`, 'navy')

  staff.passwordHash = undefined
  res.status(201).json({ staff, tempPassword })
})
