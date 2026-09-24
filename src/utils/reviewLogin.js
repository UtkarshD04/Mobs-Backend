import crypto from 'node:crypto'
import { env } from '../config/env.js'
import Employee from '../models/Employee.js'

// A login for app-store reviewers (Google Play's "App access" instructions). A reviewer
// can't receive an SMS or an email code on our behalf and isn't allowed to create accounts,
// so one reserved mobile number accepts a fixed OTP instead, and its account is created
// ready to use: verified resume, premium, nothing to pay for.
//
// It is OFF unless BOTH REVIEW_LOGIN_PHONE (10-digit Indian mobile) and REVIEW_LOGIN_OTP
// (6 digits) are set. Only that one number is affected; every other number still goes through
// MSG91 as usual. The account holds no real data, applications made from it never reach
// employers (see employeeApplicationController), and deleting it just recreates it.
export const REVIEW_EMAIL = 'play-review@mzobs.com'
const PHONE_RE = /^[6-9]\d{9}$/

export function isReviewLoginEnabled() {
  const { phone, otp } = env.reviewLogin
  return PHONE_RE.test(phone) && /^\d{6}$/.test(otp)
}

export function isReviewPhone(phone) {
  return isReviewLoginEnabled() && typeof phone === 'string' && phone.trim() === env.reviewLogin.phone
}

export function isReviewAccount(employee) {
  return isReviewLoginEnabled() && employee?.email === REVIEW_EMAIL
}

export function reviewOtpMatches(otp) {
  if (typeof otp !== 'string') return false
  const a = crypto.createHash('sha256').update(otp.trim()).digest()
  const b = crypto.createHash('sha256').update(env.reviewLogin.otp).digest()
  return crypto.timingSafeEqual(a, b)
}

// Creates (or repairs) the review account. Refuses to touch a real user's account: if the
// reserved number already belongs to someone else, that is a configuration mistake and
// nobody gets upgraded to premium by it.
export async function ensureReviewAccount() {
  const phone = env.reviewLogin.phone
  const existing = await Employee.findOne({ phone })
  if (existing && existing.email !== REVIEW_EMAIL) {
    const err = new Error('The review login number belongs to a real account. Choose a different REVIEW_LOGIN_PHONE.')
    err.status = 409
    throw err
  }

  const now = new Date()
  const employee = existing ?? new Employee({ name: 'Play Review', email: REVIEW_EMAIL, phone })
  employee.phoneVerified = true
  employee.emailVerified = true
  if (!existing) employee.status = 'active'
  employee.resumeHeadline = employee.resumeHeadline || 'Review account'
  employee.resume.status = 'verified'
  employee.resume.file = employee.resume.file || 'review-resume.pdf'
  employee.resume.version = employee.resume.version || 1
  employee.resume.uploadedOn = employee.resume.uploadedOn ?? now
  employee.resume.verifiedOn = employee.resume.verifiedOn ?? now
  employee.profileCompletedAt = employee.profileCompletedAt ?? now
  employee.subscription.status = 'paid'
  employee.subscription.amount = 0
  employee.subscription.paidOn = employee.subscription.paidOn ?? now
  await employee.save()
  return employee
}
