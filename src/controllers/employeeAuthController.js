import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { initialsOf } from '../utils/initials.js'
import { createResetToken, hashResetToken, resetPasswordEmailHtml } from '../utils/passwordReset.js'
import { sendMail } from '../utils/mailer.js'
import { verifyGoogleToken } from '../utils/googleAuth.js'
import Employee from '../models/Employee.js'
import Payment from '../models/Payment.js'
import { sendOtp, verifyOtp, verifyWidgetAccessToken } from '../utils/msg91.js'
import { issuePhoneToken, checkPhoneToken } from '../utils/phoneToken.js'

const PHONE_RE = /^[6-9]\d{9}$/

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
    phoneVerified: employee.phoneVerified,
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
  if (!employee || !employee.passwordHash) return res.status(401).json({ message: 'Invalid email or password' })

  const matches = await bcrypt.compare(password, employee.passwordHash)
  if (!matches) return res.status(401).json({ message: 'Invalid email or password' })

  if (employee.status === 'suspended') {
    return res.status(403).json({ message: 'This account has been suspended. Contact Mzobs support for help.' })
  }

  employee.lastActiveAt = new Date()
  await employee.save()

  res.json(authResponse(employee))
})

export const sendPhoneOtp = asyncHandler(async (req, res) => {
  if (!env.msg91.authKey) return res.status(503).json({ message: 'SMS verification is not configured' })

  const { phone } = req.body ?? {}
  if (typeof phone !== 'string' || !PHONE_RE.test(phone.trim())) {
    return res.status(400).json({ message: 'A valid 10-digit mobile number is required' })
  }

  await sendOtp(phone.trim())
  res.json({ message: 'OTP sent' })
})

export const verifyPhoneOtp = asyncHandler(async (req, res) => {
  if (!env.msg91.authKey) return res.status(503).json({ message: 'SMS verification is not configured' })

  const { phone, otp } = req.body ?? {}
  if (typeof phone !== 'string' || !PHONE_RE.test(phone.trim()) || typeof otp !== 'string' || !otp.trim()) {
    return res.status(400).json({ message: 'Phone and OTP are required' })
  }

  const ok = await verifyOtp(phone.trim(), otp.trim())
  if (!ok) return res.status(400).json({ message: 'Incorrect or expired OTP' })

  res.json({ phoneToken: issuePhoneToken(phone.trim()) })
})

// Companion to verifyPhoneOtp, for the website's MSG91 *widget* flow
// instead of the mobile app's direct OTP API flow — same end result (a
// phoneToken), different proof: MSG91 confirms the widget's access-token
// server-to-server instead of us checking an OTP code directly.
export const verifyPhoneWidget = asyncHandler(async (req, res) => {
  if (!env.msg91.authKey) return res.status(503).json({ message: 'SMS verification is not configured' })

  const { phone, accessToken } = req.body ?? {}
  if (typeof phone !== 'string' || !PHONE_RE.test(phone.trim()) || typeof accessToken !== 'string' || !accessToken.trim()) {
    return res.status(400).json({ message: 'Phone and access token are required' })
  }

  const verifiedIdentifier = await verifyWidgetAccessToken(accessToken.trim())
  if (!verifiedIdentifier || !verifiedIdentifier.includes(phone.trim())) {
    return res.status(400).json({ message: 'Could not verify this access token for the given phone number' })
  }

  res.json({ phoneToken: issuePhoneToken(phone.trim()) })
})

export const signup = asyncHandler(async (req, res) => {
  const { name, email, phone, password, experience, graduation, city, state, pincode, paymentOrderId, phoneToken } = req.body ?? {}
  const required = { name, email, phone, password, graduation }
  if (Object.values(required).some((v) => typeof v !== 'string' || !v.trim())) {
    return res.status(400).json({ message: 'Name, email, phone, password and graduation are required' })
  }
  if (password.length < 8) {
    return res.status(400).json({ message: 'Password must be at least 8 characters' })
  }
  if (typeof pincode === 'string' && pincode.trim() && !/^\d{6}$/.test(pincode.trim())) {
    return res.status(400).json({ message: 'Enter a valid 6-digit pincode' })
  }
  // Same "blank config = no-op" pattern as SMTP/VAPID/Razorpay/Google
  // elsewhere in this codebase: with MSG91_AUTH_KEY unset, send-otp/verify-
  // otp already 503 (see sendPhoneOtp/verifyPhoneOtp above), so a phoneToken
  // could never be obtained — this would otherwise block signup entirely.
  // The requirement re-activates on its own once MSG91 is configured.
  if (env.msg91.authKey && (typeof phoneToken !== 'string' || !checkPhoneToken(phoneToken, phone.trim()))) {
    return res.status(400).json({ message: 'Please verify your mobile number first' })
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
    phoneVerified: Boolean(env.msg91.authKey),
    passwordHash,
    experience: experience === 'experienced' ? 'experienced' : 'fresher',
    graduation,
    currentCity: typeof city === 'string' ? city.trim() : '',
    state: typeof state === 'string' ? state.trim() : '',
    pincode: typeof pincode === 'string' ? pincode.trim() : '',
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

// Signs in an existing employee account via a Google ID token. Deliberately
// does not create an account on a missing match — signup needs phone/
// graduation Google can't supply, so that has to go through googleSignup.
export const googleLogin = asyncHandler(async (req, res) => {
  const { credential } = req.body ?? {}
  const { googleId, email } = await verifyGoogleToken(credential)

  const employee = await Employee.findOne({ email })
  if (!employee) return res.status(404).json({ message: 'No account found for this Google email. Please sign up first.' })

  if (!employee.googleId) {
    employee.googleId = googleId
  }
  if (employee.status === 'suspended') {
    return res.status(403).json({ message: 'This account has been suspended. Contact Mzobs support for help.' })
  }

  employee.lastActiveAt = new Date()
  await employee.save()

  res.json(authResponse(employee))
})

export const googleSignup = asyncHandler(async (req, res) => {
  const { credential, phone, experience, graduation, city, state, pincode, paymentOrderId, phoneToken } = req.body ?? {}
  const required = { phone, graduation }
  if (Object.values(required).some((v) => typeof v !== 'string' || !v.trim())) {
    return res.status(400).json({ message: 'Phone and graduation are required' })
  }
  if (typeof pincode === 'string' && pincode.trim() && !/^\d{6}$/.test(pincode.trim())) {
    return res.status(400).json({ message: 'Enter a valid 6-digit pincode' })
  }
  // See the matching comment in signup() above — bypassed while MSG91 isn't
  // configured, since a phoneToken could never be obtained otherwise.
  if (env.msg91.authKey && (typeof phoneToken !== 'string' || !checkPhoneToken(phoneToken, phone.trim()))) {
    return res.status(400).json({ message: 'Please verify your mobile number first' })
  }

  const { googleId, email, name } = await verifyGoogleToken(credential)

  const existing = await Employee.findOne({ email })
  if (existing) return res.status(409).json({ message: 'An account with this email already exists' })

  let claimedPayment = null
  if (typeof paymentOrderId === 'string' && paymentOrderId.trim()) {
    claimedPayment = await Payment.findOne({
      razorpayOrderId: paymentOrderId.trim(),
      purpose: 'employee_subscription',
      employee: null,
      status: 'paid',
    })
  }

  const employee = await Employee.create({
    name: name || email,
    email,
    phone: phone.trim(),
    phoneVerified: Boolean(env.msg91.authKey),
    googleId,
    experience: experience === 'experienced' ? 'experienced' : 'fresher',
    graduation,
    currentCity: typeof city === 'string' ? city.trim() : '',
    state: typeof state === 'string' ? state.trim() : '',
    pincode: typeof pincode === 'string' ? pincode.trim() : '',
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
