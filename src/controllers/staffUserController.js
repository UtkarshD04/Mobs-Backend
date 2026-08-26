import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import User from '../models/User.js'
import Company from '../models/Company.js'

const ROLES = ['Admin', 'Hiring Manager', 'Recruiter', 'Interviewer']

export const listUsers = asyncHandler(async (req, res) => {
  const { search, companyId, status } = req.query
  const query = {}

  if (companyId) query.company = companyId
  if (status && status !== 'all') query.status = status
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ name: regex }, { email: regex }]
  }

  const { data, page, limit, total } = await paginate(User, query, paginationParams(req), {
    sort: { createdAt: -1 },
    populate: { path: 'company', select: 'name logo' },
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

// Staff provisions a login for an existing company — same temp-password
// pattern as staffTeamController.createTeammate, since there's no
// invite-accept email flow for this account type either.
export const createUser = asyncHandler(async (req, res) => {
  const { companyId, name, email, role } = req.body ?? {}
  if (!companyId || !name || !email || !role) {
    return res.status(400).json({ message: 'companyId, name, email and role are required' })
  }
  if (!ROLES.includes(role)) return res.status(400).json({ message: 'Invalid role' })

  const company = await Company.findById(companyId)
  if (!company) return res.status(404).json({ message: 'Company not found' })

  const normalizedEmail = email.toLowerCase().trim()
  const existing = await User.findOne({ email: normalizedEmail })
  if (existing) return res.status(409).json({ message: 'An account with this email already exists' })

  const tempPassword = crypto.randomBytes(9).toString('base64url')
  const passwordHash = await bcrypt.hash(tempPassword, 10)

  const user = await User.create({
    company: company._id,
    name: name.trim(),
    email: normalizedEmail,
    role,
    passwordHash,
    status: 'active',
  })

  await logStaffActivity(`${req.staff.name} created a ${role} login for ${user.name} at ${company.name}`, 'navy')

  user.passwordHash = undefined
  res.status(201).json({ user, tempPassword })
})

export const setUserStatus = asyncHandler(async (req, res) => {
  const { status } = req.body ?? {}
  if (!['active', 'disabled'].includes(status)) {
    return res.status(400).json({ message: 'status must be active or disabled' })
  }

  const user = await User.findById(req.params.id)
  if (!user) return res.status(404).json({ message: 'User not found' })

  user.status = status
  await user.save()

  await logStaffActivity(`${req.staff.name} ${status === 'disabled' ? 'disabled' : 'reactivated'} ${user.name}'s login`, status === 'disabled' ? 'red' : 'green')

  res.json({ id: user._id.toString(), status: user.status })
})

// Same "can't remove the last Admin" guard as the employer's own self-service
// teamController.removeMember — this just gives staff the same power across
// any company, and no cascade beyond that (Job.createdBy/SupportTicket.user
// are left as historical references, matching removeMember's behavior).
export const deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
  if (!user) return res.status(404).json({ message: 'User not found' })

  if (user.role === 'Admin') {
    const adminCount = await User.countDocuments({ company: user.company, role: 'Admin' })
    if (adminCount <= 1) return res.status(400).json({ message: 'Cannot delete the last remaining Admin for this company' })
  }

  await user.deleteOne()

  await logStaffActivity(`${req.staff.name} deleted ${user.name}'s login`, 'gold')

  res.json({ id: req.params.id })
})
