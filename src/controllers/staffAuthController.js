import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { initialsOf } from '../utils/initials.js'
import { createResetToken, hashResetToken, resetPasswordEmailHtml } from '../utils/passwordReset.js'
import { sendMail } from '../utils/mailer.js'
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
    accessLevel: staff.accessLevel,
    initials: initialsOf(staff.name),
  }
}

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ message: 'Email and password are required' })
  }

  const staff = await StaffUser.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash')
  if (!staff) return res.status(401).json({ message: 'Invalid email or password' })
  if (staff.status === 'disabled') return res.status(401).json({ message: 'This staff account has been disabled' })

  const matches = await bcrypt.compare(password, staff.passwordHash)
  if (!matches) return res.status(401).json({ message: 'Invalid email or password' })

  staff.lastActiveAt = new Date()
  await staff.save()

  res.json({ token: issueToken(staff), staff: staffSummary(staff) })
})

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body ?? {}
  if (typeof email !== 'string' || !email.trim()) return res.status(400).json({ message: 'Email is required' })

  const staff = await StaffUser.findOne({ email: email.toLowerCase().trim() })

  // Always respond the same way whether or not the account exists, so this
  // endpoint can't be used to enumerate staff emails.
  if (staff) {
    const { token, tokenHash, expires } = createResetToken()
    staff.resetPasswordToken = tokenHash
    staff.resetPasswordExpires = expires
    await staff.save()

    const resetUrl = `${env.staffFrontendUrl}/reset-password?token=${token}`
    await sendMail({
      to: staff.email,
      subject: 'Reset your Mzobs staff password',
      html: resetPasswordEmailHtml({ name: staff.name, resetUrl }),
    })
  }

  res.json({ message: 'If a staff account exists for that email, a reset link has been sent.' })
})

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body ?? {}
  if (typeof token !== 'string' || typeof password !== 'string' || !token || !password) {
    return res.status(400).json({ message: 'Token and new password are required' })
  }
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })

  const tokenHash = hashResetToken(token)
  const staff = await StaffUser.findOne({
    resetPasswordToken: tokenHash,
    resetPasswordExpires: { $gt: new Date() },
  }).select('+resetPasswordToken +resetPasswordExpires')

  if (!staff) return res.status(400).json({ message: 'This reset link is invalid or has expired' })

  staff.passwordHash = await bcrypt.hash(password, 10)
  staff.resetPasswordToken = null
  staff.resetPasswordExpires = null
  await staff.save()

  res.json({ message: 'Your password has been reset. You can now sign in.' })
})

export const getMe = asyncHandler(async (req, res) => {
  res.json(staffSummary(req.staff))
})
