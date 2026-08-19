import { asyncHandler } from '../utils/asyncHandler.js'
import { initialsOf } from '../utils/initials.js'
import { formatRelative, formatDisplayDate } from '../utils/formatDate.js'
import { logActivity } from '../utils/activityLog.js'
import User from '../models/User.js'

function toTeamMember(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    initials: initialsOf(user.name),
    role: user.role,
    email: user.email,
    status: user.status,
    lastActive: formatRelative(user.lastActiveAt),
    joinedOn: formatDisplayDate(user.createdAt),
  }
}

export const listTeam = asyncHandler(async (req, res) => {
  const members = await User.find({ company: req.company._id }).sort({ createdAt: 1 })
  res.json(members.map(toTeamMember))
})

export const inviteMember = asyncHandler(async (req, res) => {
  const { name, email, role } = req.body ?? {}
  if (!name || !email || !role) {
    return res.status(400).json({ message: 'Name, email and role are required' })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const existing = await User.findOne({ email: normalizedEmail })
  if (existing) return res.status(409).json({ message: 'A team member with this email already exists' })

  const member = await User.create({
    company: req.company._id,
    name: name.trim(),
    email: normalizedEmail,
    role,
    status: 'invited',
  })

  await logActivity(req.company._id, `${member.name} invited to the team as ${member.role}`, 'navy')

  res.status(201).json(toTeamMember(member))
})

export const updateMemberRole = asyncHandler(async (req, res) => {
  const { role } = req.body ?? {}
  if (!role) return res.status(400).json({ message: 'role is required' })

  const member = await User.findOneAndUpdate({ _id: req.params.id, company: req.company._id }, { role }, { new: true, runValidators: true })
  if (!member) return res.status(404).json({ message: 'Team member not found' })

  res.json(toTeamMember(member))
})

export const removeMember = asyncHandler(async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    return res.status(400).json({ message: 'You cannot remove yourself from the team' })
  }

  const member = await User.findOne({ _id: req.params.id, company: req.company._id })
  if (!member) return res.status(404).json({ message: 'Team member not found' })

  if (member.role === 'Admin') {
    const adminCount = await User.countDocuments({ company: req.company._id, role: 'Admin' })
    if (adminCount <= 1) return res.status(400).json({ message: 'Cannot remove the last remaining Admin' })
  }

  await member.deleteOne()
  await logActivity(req.company._id, `${member.name} removed from the team`, 'navy')

  res.json({ success: true })
})
