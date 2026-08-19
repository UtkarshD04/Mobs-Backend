import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { initialsOf } from '../utils/initials.js'
import { createResetToken, hashResetToken, resetPasswordEmailHtml } from '../utils/passwordReset.js'
import { sendMail } from '../utils/mailer.js'
import Employee from '../models/Employee.js'
import Payment from '../models/Payment.js'

function issueToken(employee) {
  return jwt.sign({ sub: employee._id.toString(), type: 'employee' }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  })
}

function employeeSummary(employee) {
  return {
    id: employee._id.toString(),
    name: employee.name,
    email: employee.email,
    phone: employee.phone,
    experience: employee.experience,
    graduation: employee.graduation,
    initials: initialsOf(employee.name),
  }
}

function authResponse(employee) {
  return { token: issueToken(employee), employee: employeeSummary(employee) }
}

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body ?? {}
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return res.status(400).json({ message: 'Email and password are required' })
  }

  const employee = await Employee.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash')
  if (!employee) return res.status(401).json({ message: 'Invalid email or password' })

  const matches = await bcrypt.compare(password, employee.passwordHash)
  if (!matches) return res.status(401).json({ message: 'Invalid email or password' })

  employee.lastActiveAt = new Date()
  await employee.save()

  res.json(authResponse(employee))
})

export const signup = asyncHandler(async (req, res) => {
  const { name, email, phone, password, experience, graduation, paymentOrderId } = req.body ?? {}
  const required = { name, email, phone, password, graduation }
  if (Object.values(required).some((v) => typeof v !== 'string' || !v.trim())) {
    return res.status(400).json({ message: 'Name, email, phone, password and graduation are required' })
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' })
  }

  const normalizedEmail = email.toLowerCase().trim()
  const existing = await Employee.findOne({ email: normalizedEmail })
  if (existing) return res.status(409).json({ message: 'An account with this email already exists' })

  // If the marketing site's "pay first" flow already collected the ₹99 fee,
  // it hands back the order id here — claim that unlinked payment onto the
  // new account so it starts out already subscribed. A missing/invalid/
  // already-claimed id just means the account starts unpaid, same as before
  // this flow existed.
  let claimedPayment = null
  if (typeof paymentOrderId === 'string' && paymentOrderId.trim()) {
    claimedPayment = await Payment.findOne({
      razorpayOrderId: paymentOrderId.trim(),
      purpose: 'employee_subscription',
      employee: null,
      status: 'paid',
    })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const employee = await Employee.create({
    name: name.trim(),
    email: normalizedEmail,
    phone: phone.trim(),
    passwordHash,
    experience: experience === 'experienced' ? 'experienced' : 'fresher',
    graduation,
    status: 'active',
    lastActiveAt: new Date(),
    subscription: claimedPayment ? { status: 'paid', amount: claimedPayment.amount, paidOn: claimedPayment.paidAt } : undefined,
  })

  if (claimedPayment) {
    claimedPayment.employee = employee._id
    await claimedPayment.save()
  }

  res.status(201).json(authResponse(employee))
})

export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body ?? {}
  if (typeof email !== 'string' || !email.trim()) return res.status(400).json({ message: 'Email is required' })

  const employee = await Employee.findOne({ email: email.toLowerCase().trim() })

  // Always respond the same way whether or not the account exists, so this
  // endpoint can't be used to enumerate registered employee emails.
  if (employee) {
    const { token, tokenHash, expires } = createResetToken()
    employee.resetPasswordToken = tokenHash
    employee.resetPasswordExpires = expires
    await employee.save()

    const resetUrl = `${env.frontendUrl}/employees/reset-password?token=${token}`
    await sendMail({
      to: employee.email,
      subject: 'Reset your Mzobs password',
      html: resetPasswordEmailHtml({ name: employee.name, resetUrl }),
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
  const employee = await Employee.findOne({
    resetPasswordToken: tokenHash,
    resetPasswordExpires: { $gt: new Date() },
  }).select('+resetPasswordToken +resetPasswordExpires')

  if (!employee) return res.status(400).json({ message: 'This reset link is invalid or has expired' })

  employee.passwordHash = await bcrypt.hash(password, 10)
  employee.resetPasswordToken = null
  employee.resetPasswordExpires = null
  await employee.save()

  res.json({ message: 'Your password has been reset. You can now sign in.' })
})

export const getMe = asyncHandler(async (req, res) => {
  res.json(employeeSummary(req.employee))
})

export const updateMe = asyncHandler(async (req, res) => {
  const { name } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ message: 'name is required' })

  req.employee.name = name.trim()
  await req.employee.save()

  res.json(employeeSummary(req.employee))
})
