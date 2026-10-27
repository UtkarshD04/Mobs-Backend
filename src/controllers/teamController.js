import mongoose from 'mongoose'
import { asyncHandler } from '../utils/asyncHandler.js'
import { initialsOf } from '../utils/initials.js'
import { formatRelative, formatDisplayDate } from '../utils/formatDate.js'
import { logActivity } from '../utils/activityLog.js'
import { audit, AUDIT_ACTIONS } from '../utils/audit.js'
import { ASSIGNABLE_ROLES, ROLE_PERMISSIONS, PERMISSIONS, can, permissionsFor } from '../utils/permissions.js'
import User from '../models/User.js'
import AuditLog from '../models/AuditLog.js'

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isOwner = (role) => role === 'Owner'
const ADMINS = ['Owner', 'Admin']

function toTeamMember(user, { withEmail = true } = {}) {
  return {
    id: user._id.toString(),
    name: user.name,
    initials: initialsOf(user.name),
    role: user.role,
    email: withEmail ? user.email : undefined,
    status: user.status,
    lastActive: formatRelative(user.lastActiveAt),
    joinedOn: formatDisplayDate(user.createdAt),
  }
}

// Only an Owner can create, change or remove an Owner — an Admin cannot promote themselves past their own level.
// (A company whose accounts predate the Owner role has no Owner yet; there an Admin may assign the first one.)
async function ownerGuard(req, { touchesOwner }) {
  if (!touchesOwner || isOwner(req.user.role)) return null
  if (await User.exists({ company: req.company._id, role: 'Owner', status: { $ne: 'disabled' } })) return 'Only an Owner can change Owner access.'
  return null
}

async function otherAdminsExist(companyId, excludeId) {
  return !!(await User.exists({ company: companyId, _id: { $ne: excludeId }, role: { $in: ADMINS }, status: { $ne: 'disabled' } }))
}

// GET /team/me — the signed-in user's role and what it allows, so the UI shows only what the API will accept.
export const getMe = (req, res) => {
  res.json({ id: req.user._id.toString(), name: req.user.name, email: req.user.email, role: req.user.role, permissions: permissionsFor(req.user.role) })
}

// GET /team/roles — the permission matrix, for the Team & Permissions page.
export const getRoleMatrix = (_req, res) => {
  res.json({
    roles: ASSIGNABLE_ROLES,
    permissions: Object.entries(PERMISSIONS).map(([key, label]) => ({ key, label, roles: ASSIGNABLE_ROLES.filter((r) => (ROLE_PERMISSIONS[r] ?? []).includes(key)) })),
  })
}

export const listTeam = asyncHandler(async (req, res) => {
  const members = await User.find({ company: req.company._id }).sort({ createdAt: 1 })
  const withEmail = can(req.user.role, 'team.manage')
  res.json(members.map((m) => toTeamMember(m, { withEmail })))
})

export const inviteMember = asyncHandler(async (req, res) => {
  const { name, email, role } = req.body ?? {}
  if (!name || !email || !role) {
    return res.status(400).json({ message: 'Name, email and role are required' })
  }
  if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ message: `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` })
  const normalizedEmail = String(email).toLowerCase().trim()
  if (!EMAIL_RX.test(normalizedEmail)) return res.status(400).json({ message: 'Enter a valid email address.' })
  const denied = await ownerGuard(req, { touchesOwner: isOwner(role) })
  if (denied) return res.status(403).json({ code: 'FORBIDDEN', message: denied })

  const existing = await User.findOne({ email: normalizedEmail })
  if (existing) return res.status(409).json({ message: 'A team member with this email already exists' })

  const member = await User.create({
    company: req.company._id,
    name: String(name).trim().slice(0, 80),
    email: normalizedEmail,
    role,
    status: 'invited',
  })

  await logActivity(req.company._id, `${member.name} invited to the team as ${member.role}`, 'navy')
  await audit(req, 'team.invited', { targetType: 'user', targetId: member._id, targetLabel: member.name, detail: `as ${member.role}` })

  res.status(201).json(toTeamMember(member))
})

export const updateMemberRole = asyncHandler(async (req, res) => {
  const { role } = req.body ?? {}
  if (!role) return res.status(400).json({ message: 'role is required' })
  if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ message: `Role must be one of: ${ASSIGNABLE_ROLES.join(', ')}` })
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Team member not found' })
  if (req.params.id === req.user._id.toString()) return res.status(400).json({ message: 'You cannot change your own role. Ask another Owner or Admin.' })

  const member = await User.findOne({ _id: req.params.id, company: req.company._id })
  if (!member) return res.status(404).json({ message: 'Team member not found' })
  const denied = await ownerGuard(req, { touchesOwner: isOwner(role) || isOwner(member.role) })
  if (denied) return res.status(403).json({ code: 'FORBIDDEN', message: denied })
  if (ADMINS.includes(member.role) && !ADMINS.includes(role) && !(await otherAdminsExist(req.company._id, member._id))) {
    return res.status(400).json({ message: 'The company must keep at least one Owner or Admin.' })
  }

  const previous = member.role
  member.role = role
  await member.save()
  await audit(req, 'team.role_changed', { targetType: 'user', targetId: member._id, targetLabel: member.name, detail: `${previous} → ${role}` })

  res.json(toTeamMember(member))
})

export const removeMember = asyncHandler(async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ message: 'You cannot remove yourself from the team' })
  }
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Team member not found' })

  const member = await User.findOne({ _id: req.params.id, company: req.company._id })
  if (!member) return res.status(404).json({ message: 'Team member not found' })
  const denied = await ownerGuard(req, { touchesOwner: isOwner(member.role) })
  if (denied) return res.status(403).json({ code: 'FORBIDDEN', message: denied })

  if (ADMINS.includes(member.role) && !(await otherAdminsExist(req.company._id, member._id))) {
    return res.status(400).json({ message: 'Cannot remove the last remaining Owner or Admin' })
  }

  await member.deleteOne()
  await logActivity(req.company._id, `${member.name} removed from the team`, 'navy')
  await audit(req, 'team.removed', { targetType: 'user', targetId: member._id, targetLabel: member.name, detail: member.role })

  res.json({ success: true })
})

// GET /team/audit?action=&actor=&page= — newest first, 50 per page.
export const listAudit = asyncHandler(async (req, res) => {
  const query = { company: req.company._id }
  if (req.query.action && Object.hasOwn(AUDIT_ACTIONS, req.query.action)) query.action = req.query.action
  if (mongoose.isValidObjectId(req.query.actor)) query.actor = req.query.actor
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const limit = 50
  const [rows, total] = await Promise.all([AuditLog.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit), AuditLog.countDocuments(query)])
  res.json({ total, page, pages: Math.max(1, Math.ceil(total / limit)), actions: AUDIT_ACTIONS, items: rows.map((r) => ({ id: r.id, action: r.action, label: AUDIT_ACTIONS[r.action] ?? r.action, actorName: r.actorName, actorRole: r.actorRole, targetType: r.targetType, targetId: r.targetId, targetLabel: r.targetLabel, detail: r.detail, at: r.createdAt })) })
})
