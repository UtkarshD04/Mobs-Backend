import bcrypt from 'bcryptjs'
import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import { sendMail } from '../utils/mailer.js'
import { staffCredentialsEmailHtml } from '../utils/staffWelcomeEmail.js'
import { env } from '../config/env.js'
import StaffUser from '../models/StaffUser.js'

const ROLES = ['Operations Manager', 'Resume Verification Lead', 'Interview Panel', 'Employer Success', 'Compliance & KYC']

export const listTeam = asyncHandler(async (req, res) => {
  const { search, accessLevel, status } = req.query
  const query = {}

  if (accessLevel && ['admin', 'staff'].includes(accessLevel)) query.accessLevel = accessLevel
  if (status && ['active', 'invited', 'disabled'].includes(status)) query.status = status
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ name: regex }, { email: regex }]
  }

  const { data, page, limit, total } = await paginate(StaffUser, query, paginationParams(req), { sort: { createdAt: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

// Admin sets the password directly (no auto-generation) — still emailed to
// the new teammate so they have it in writing (sendMail no-ops to a log
// line if SMTP isn't configured, same graceful-degrade as password-reset mail).
export const createTeammate = asyncHandler(async (req, res) => {
  const { name, email, password, role, accessLevel } = req.body ?? {}
  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: 'name, email, password and role are required' })
  }
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })
  if (!ROLES.includes(role)) return res.status(400).json({ message: 'Invalid role' })
  if (accessLevel && !['admin', 'staff'].includes(accessLevel)) {
    return res.status(400).json({ message: 'Invalid access level' })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const existing = await StaffUser.findOne({ email: normalizedEmail })
  if (existing) return res.status(409).json({ message: 'A staff account with this email already exists' })

  const passwordHash = await bcrypt.hash(password, 10)

  const staff = await StaffUser.create({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    role,
    accessLevel: accessLevel ?? 'staff',
    status: 'invited',
  })

  await logStaffActivity(`${req.staff.name} added ${staff.name} to the team as ${role}`, 'navy')
  await sendMail({
    to: staff.email,
    subject: 'Your Mzobs staff account is ready',
    html: staffCredentialsEmailHtml({
      name: staff.name,
      email: staff.email,
      tempPassword: password,
      loginUrl: `${env.staffFrontendUrl}/login`,
      isNewAccount: true,
    }),
  })

  staff.passwordHash = undefined
  res.status(201).json({ staff })
})

export const updateTeammate = asyncHandler(async (req, res) => {
  const { name, email, role, accessLevel, status } = req.body ?? {}
  if ([name, email, role, accessLevel, status].every((v) => v === undefined)) {
    return res.status(400).json({ message: 'Nothing to update' })
  }
  if (role !== undefined && !ROLES.includes(role)) return res.status(400).json({ message: 'Invalid role' })
  if (accessLevel !== undefined && !['admin', 'staff'].includes(accessLevel)) {
    return res.status(400).json({ message: 'Invalid access level' })
  }
  if (status !== undefined && !['active', 'invited', 'disabled'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' })
  }

  const staff = await StaffUser.findById(req.params.id)
  if (!staff) return res.status(404).json({ message: 'Staff account not found' })

  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ message: 'name cannot be empty' })
    staff.name = name.trim()
  }
  if (email !== undefined) {
    const normalizedEmail = email.toLowerCase().trim()
    if (!normalizedEmail) return res.status(400).json({ message: 'email cannot be empty' })
    const existing = await StaffUser.findOne({ email: normalizedEmail, _id: { $ne: staff._id } })
    if (existing) return res.status(409).json({ message: 'A staff account with this email already exists' })
    staff.email = normalizedEmail
  }
  if (role !== undefined) staff.role = role
  if (accessLevel !== undefined) {
    if (staff.accessLevel === 'admin' && accessLevel === 'staff') {
      const adminCount = await StaffUser.countDocuments({ accessLevel: 'admin' })
      if (adminCount <= 1) return res.status(400).json({ message: 'Cannot demote the last remaining admin' })
    }
    staff.accessLevel = accessLevel
  }
  if (status !== undefined) staff.status = status
  await staff.save()

  await logStaffActivity(`${req.staff.name} updated ${staff.name}'s account`, 'navy')

  res.json({ staff })
})

// Admin sets the new password directly, same as createTeammate — emailed to
// the teammate so they have it in writing.
export const resetTeammatePassword = asyncHandler(async (req, res) => {
  const { password } = req.body ?? {}
  if (!password || password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })

  const staff = await StaffUser.findById(req.params.id)
  if (!staff) return res.status(404).json({ message: 'Staff account not found' })

  staff.passwordHash = await bcrypt.hash(password, 10)
  await staff.save()

  await logStaffActivity(`${req.staff.name} reset ${staff.name}'s password`, 'gold')
  await sendMail({
    to: staff.email,
    subject: 'Your Mzobs staff password has been reset',
    html: staffCredentialsEmailHtml({
      name: staff.name,
      email: staff.email,
      tempPassword: password,
      loginUrl: `${env.staffFrontendUrl}/login`,
      isNewAccount: false,
    }),
  })

  res.json({ success: true })
})

// No cascade — the handful of refs to a deleted StaffUser (resume/mock-
// interview assignment history, coupon authorship) are all optional
// attribution fields, left as-is per the same "leave historical records"
// convention deleteCompany follows.
export const deleteTeammate = asyncHandler(async (req, res) => {
  if (req.params.id === req.staff._id.toString()) {
    return res.status(400).json({ message: 'You cannot delete your own account' })
  }

  const staff = await StaffUser.findById(req.params.id)
  if (!staff) return res.status(404).json({ message: 'Staff account not found' })

  if (staff.accessLevel === 'admin') {
    const adminCount = await StaffUser.countDocuments({ accessLevel: 'admin' })
    if (adminCount <= 1) return res.status(400).json({ message: 'Cannot delete the last remaining admin' })
  }

  await staff.deleteOne()

  await logStaffActivity(`${req.staff.name} deleted ${staff.name}'s staff account`, 'gold')

  res.json({ id: req.params.id })
})
