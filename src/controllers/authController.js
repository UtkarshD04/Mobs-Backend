import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { initialsOf } from '../utils/initials.js'
import { createResetToken, hashResetToken, resetPasswordEmailHtml } from '../utils/passwordReset.js'
import { sendMail } from '../utils/mailer.js'
import { verifyGoogleToken } from '../utils/googleAuth.js'
import { verifyWidgetAccessToken } from '../utils/msg91.js'
import { issuePhoneToken } from '../utils/phoneToken.js'
import { getRazorpayClient } from '../config/razorpay.js'
import { verifyOrderPaymentSignature } from '../utils/razorpaySignature.js'
import { getEmployerPlanPricing } from '../utils/employerPlanPricing.js'
import { ONE_YEAR_MS } from '../utils/activateEmployerSubscription.js'
import { logActivity } from '../utils/activityLog.js'
import User from '../models/User.js'
import Company from '../models/Company.js'
import EmployerSubscription from '../models/EmployerSubscription.js'
import Payment from '../models/Payment.js'

const PHONE_RE = /^[6-9]\d{9}$/

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

  if (user.status === 'disabled') {
    return res.status(403).json({ message: 'This account has been disabled. Contact Mzobs support for help.' })
  }
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

// Signs in an existing employer account via a Google ID token. Deliberately
// does not create an account on a missing match — employer signup needs
// company details Google can't supply, so that has to go through
// googleSignup instead.
export const googleLogin = asyncHandler(async (req, res) => {
  const { credential } = req.body ?? {}
  const { googleId, email } = await verifyGoogleToken(credential)

  const user = await User.findOne({ email }).select('+passwordHash').populate('company')
  if (!user) return res.status(404).json({ message: 'No account found for this Google email. Please sign up first.' })

  if (!user.googleId) {
    user.googleId = googleId
  }
  if (user.status === 'disabled') {
    return res.status(403).json({ message: 'This account has been disabled. Contact Mzobs support for help.' })
  }
  if (user.company?.blocked) {
    return res.status(403).json({ message: 'This company account has been blocked. Contact Mzobs support for help.' })
  }

  user.lastActiveAt = new Date()
  await user.save()

  res.json(authResponse(user, user.company))
})

export const googleSignup = asyncHandler(async (req, res) => {
  const { credential, companyName, phone, industry, size, website, hq } = req.body ?? {}
  const required = { companyName, phone, industry, size, website, hq }
  if (Object.values(required).some((v) => typeof v !== 'string' || !v.trim())) {
    return res.status(400).json({ message: 'All company fields are required to register your company' })
  }

  const { googleId, email, name } = await verifyGoogleToken(credential)

  const existing = await User.findOne({ email })
  if (existing) return res.status(409).json({ message: 'An account with this email already exists' })

  const company = await Company.create({
    name: companyName.trim(),
    industry: industry.trim(),
    size,
    website: website.trim(),
    hq: hq.trim(),
  })

  const user = await User.create({
    company: company._id,
    name: name || email,
    email,
    phone: phone.trim(),
    googleId,
    role: 'Admin',
    status: 'active',
    lastActiveAt: new Date(),
  })

  res.status(201).json(authResponse(user, company))
})

// Companion to the employee side's verifyPhoneWidget — same MSG91 widget
// flow, same phoneToken shape, just mounted under the employer's public
// auth routes.
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

// POST /api/employer/subscription/guest-verify — the "just your phone
// number, pay, account is created for you" flow off the public pricing
// page. No signup form and no OTP: this call both settles the payment and
// creates their Company + Admin User + an already-active
// EmployerSubscription in one shot. Since there's no email they chose, a
// generated placeholder + one-time password is returned so they still have
// a way back in later (same "shown once" pattern as
// staffCompanyController.createCompany's tempPassword) — the dashboard
// redirect uses the returned token so they don't need it immediately.
export const guestSubscribeSignup = asyncHandler(async (req, res) => {
  const { phone, razorpay_order_id, razorpay_payment_id, razorpay_signature, mockOrderId } = req.body ?? {}

  if (typeof phone !== 'string' || !PHONE_RE.test(phone.trim())) {
    return res.status(400).json({ message: 'A valid 10-digit mobile number is required' })
  }

  const orderId = razorpay_order_id ?? mockOrderId
  if (!orderId) return res.status(400).json({ message: 'Missing payment details' })

  const payment = await Payment.findOne({ razorpayOrderId: orderId, purpose: 'employer_subscription' })
  if (!payment) return res.status(404).json({ message: 'Order not found' })

  // Already claimed — either a retry of this same call (payment succeeded,
  // the response was lost/interrupted before reaching the client) or an
  // orderId that was never a guest order to begin with. Phone is unverified
  // here, so this is a courtesy match for retries, not an access control —
  // it hands back a token only when the typed phone happens to match.
  if (payment.company) {
    const existingUser = await User.findOne({ company: payment.company, phone: phone.trim() }).populate('company')
    if (existingUser) return res.status(201).json(authResponse(existingUser, existingUser.company))
    return res.status(409).json({ message: 'This order is not available for guest checkout.' })
  }

  if (payment.status !== 'paid') {
    if (razorpay_order_id) {
      if (!razorpay_payment_id || !razorpay_signature) return res.status(400).json({ message: 'Missing payment details' })
      if (payment.status !== 'created') return res.status(400).json({ message: 'This order can no longer be verified' })
      if (!verifyOrderPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
        payment.status = 'failed'
        await payment.save()
        return res.status(400).json({ message: 'Payment verification failed' })
      }
      const captured = await getRazorpayClient().payments.fetch(razorpay_payment_id)
      if (captured.order_id !== razorpay_order_id || captured.status !== 'captured') {
        payment.status = 'failed'
        await payment.save()
        return res.status(400).json({ message: 'Payment was not captured' })
      }
      payment.razorpayPaymentId = razorpay_payment_id
      payment.razorpaySignature = razorpay_signature
    } else {
      // Dev-only mock path, mirrors confirmMockSubscriptionPayment — only
      // ever touches a payment actually flagged isMock, hard-blocked in prod.
      if (process.env.NODE_ENV === 'production') return res.status(503).json({ message: 'Mock payments are disabled in production' })
      if (!payment.isMock) return res.status(404).json({ message: 'Mock order not found' })
      payment.razorpayPaymentId = `mock_payment_${Date.now()}`
    }
    payment.status = 'paid'
    payment.paidAt = new Date()
    await payment.save()
  }

  const existingPhoneUser = await User.findOne({ phone: phone.trim() })
  if (existingPhoneUser) {
    return res.status(409).json({ message: 'An account already exists for this phone number. Please sign in instead.' })
  }

  const company = await Company.create({ name: 'New Employer Account' })

  const tempPassword = crypto.randomBytes(9).toString('base64url')
  const passwordHash = await bcrypt.hash(tempPassword, 10)
  const placeholderEmail = `employer-${company._id.toString()}@guest.mzobs.com`
  const user = await User.create({
    company: company._id,
    name: 'New Employer',
    email: placeholderEmail,
    phone: phone.trim(),
    passwordHash,
    role: 'Admin',
    status: 'active',
    lastActiveAt: new Date(),
  })

  const pricing = getEmployerPlanPricing()
  const startsAt = new Date()
  const expiresAt = new Date(startsAt.getTime() + ONE_YEAR_MS)
  const subscription = await EmployerSubscription.create({
    company: company._id,
    planCode: pricing.planCode,
    planName: pricing.planName,
    amount: payment.amount * 100,
    currency: payment.currency,
    billingPeriod: pricing.billingPeriod,
    status: 'active',
    startsAt,
    expiresAt,
    paymentProvider: 'razorpay',
    razorpayOrderId: payment.razorpayOrderId,
    razorpayPaymentId: payment.razorpayPaymentId,
  })

  payment.company = company._id
  payment.employerSubscription = subscription._id
  await payment.save()

  await logActivity(company._id, `${pricing.planName} activated (guest checkout) — valid until ${expiresAt.toLocaleDateString('en-IN')}`, 'green')

  res.status(201).json({ ...authResponse(user, company), tempPassword, placeholderEmail })
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
