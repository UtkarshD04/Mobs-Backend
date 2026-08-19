import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { initialsOf } from '../utils/initials.js'
import { createResetToken, hashResetToken, resetPasswordEmailHtml } from '../utils/passwordReset.js'
import { sendMail } from '../utils/mailer.js'
import User from '../models/User.js'
import Company from '../models/Company.js'

function issueToken(user, company) {
  return jwt.sign(
    { sub: user._id.toString(), companyId: company._id.toString(), role: user.role, type: 'employer' },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  )
}

function authResponse(user, company) {
  return {
    token: issueToken(user, company),
    user: {
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      initials: initialsOf(user.name),
    },
    company: {
      id: company._id.toString(),
      name: company.name,
      logo: company.logo,
    },
  }
}

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ message: 'Email and password are required' })
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() })
    .select('+passwordHash')
    .populate('company')

  if (!user || !user.passwordHash) return res.status(401).json({ message: 'Invalid email or password' })

  const matches = await bcrypt.compare(password, user.passwordHash)
  if (!matches) return res.status(401).json({ message: 'Invalid email or password' })

  if (user.company?.blocked) {
    return res.status(403).json({ message: 'This company account has been blocked. Contact Mzobs support for help.' })
  }

  user.lastActiveAt = new Date()
  await user.save()

  res.json(authResponse(user, user.company))
})

export const signup = asyncHandler(async (req, res) => {
  const { companyName, name, email, phone, password, industry, size, website, hq } = req.body ?? {}
  const required = { companyName, name, email, phone, password, industry, size, website, hq }
  if (Object.values(required).some((v) => typeof v !== 'string' || !v.trim())) {
    return res.status(400).json({ message: 'All fields are required to register your company' })
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const existing = await User.findOne({ email: normalizedEmail })
  if (existing) return res.status(409).json({ message: 'An account with this email already exists' })

  const company = await Company.create({
    name: companyName.trim(),
    industry: industry.trim(),
    size,
    website: website.trim(),
    hq: hq.trim(),
  })

  const passwordHash = await bcrypt.hash(password, 10)
  const user = await User.create({
    company: company._id,
    name: name.trim(),
    email: normalizedEmail,
    phone: phone.trim(),
    passwordHash,
    role: 'Admin',
    status: 'active',
    lastActiveAt: new Date(),
  })

  res.status(201).json(authResponse(user, company))
})

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body ?? {}
  if (typeof email !== 'string' || !email.trim()) return res.status(400).json({ message: 'Email is required' })

  const user = await User.findOne({ email: email.toLowerCase().trim() })

  // Always respond the same way whether or not the account exists, so this
  // endpoint can't be used to enumerate registered employer emails.
  if (user) {
    const { token, tokenHash, expires } = createResetToken()
    user.resetPasswordToken = tokenHash
    user.resetPasswordExpires = expires
    await user.save()

    const resetUrl = `${env.frontendUrl}/employers/reset-password?token=${token}`
    await sendMail({
      to: user.email,
      subject: 'Reset your Mzobs password',
      html: resetPasswordEmailHtml({ name: user.name, resetUrl }),
    })
  }

  res.json({ message: 'If an account exists for that email, a reset link has been sent.' })
})

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body ?? {}
  if (typeof token !== 'string' || typeof password !== 'string' || !token || !password) {
    return res.status(400).json({ message: 'Token and new password are required' })
  }
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' })

  const tokenHash = hashResetToken(token)
  const user = await User.findOne({
    resetPasswordToken: tokenHash,
    resetPasswordExpires: { $gt: new Date() },
  }).select('+resetPasswordToken +resetPasswordExpires')

  if (!user) return res.status(400).json({ message: 'This reset link is invalid or has expired' })

  user.passwordHash = await bcrypt.hash(password, 10)
  user.resetPasswordToken = null
  user.resetPasswordExpires = null
  await user.save()

  res.json({ message: 'Your password has been reset. You can now sign in.' })
})

export const getMe = asyncHandler(async (req, res) => {
  res.json({
    id: req.user._id.toString(),
    name: req.user.name,
    email: req.user.email,
    phone: req.user.phone,
    role: req.user.role,
    initials: initialsOf(req.user.name),
  })
})

export const updateMe = asyncHandler(async (req, res) => {
  const { name } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'name is required' })

  req.user.name = name.trim()
  await req.user.save()

  res.json({
    id: req.user._id.toString(),
    name: req.user.name,
    email: req.user.email,
    phone: req.user.phone,
    role: req.user.role,
    initials: initialsOf(req.user.name),
  })
})
