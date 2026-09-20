import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

// Email sign-in codes: 6 digits, valid for 10 minutes, at most 5 wrong guesses,
// and no new code within 30 seconds of the last one.
export const EMAIL_OTP_TTL_MS = 10 * 60 * 1000
export const EMAIL_OTP_MAX_ATTEMPTS = 5
export const EMAIL_OTP_RESEND_MS = 30 * 1000

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function generateEmailOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

// Keyed with the server secret and bound to the address, so a stolen row can't be
// brute-forced offline without the secret, or replayed for a different email.
export function hashEmailOtp(email, code) {
  return crypto.createHmac('sha256', env.jwtSecret).update(`${email.toLowerCase().trim()}:${code}`).digest('hex')
}

export function emailOtpMatches(email, code, codeHash) {
  const a = Buffer.from(hashEmailOtp(email, code), 'hex')
  const b = Buffer.from(String(codeHash), 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function emailOtpMessage(code) {
  const minutes = EMAIL_OTP_TTL_MS / 60000
  return {
    subject: 'Your Mzobs verification code',
    text: `Your Mzobs verification code is ${code}. It is valid for ${minutes} minutes. If you did not ask for it, you can ignore this email.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#16324f">
  <h2 style="margin:0 0 12px">Your verification code</h2>
  <p style="margin:0 0 16px;color:#64748b">Enter this code in the Mzobs app to continue.</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:0 0 16px">${code}</p>
  <p style="margin:0;color:#64748b;font-size:13px">It is valid for ${minutes} minutes. If you did not ask for it, you can ignore this email.</p>
</div>`,
  }
}

// Same idea as phoneToken: proof that this address was verified, presented on the
// follow-up email-login / signup call so a client can't just claim it.
const EMAIL_TOKEN_PURPOSE = 'email-verify'

export function issueEmailToken(email) {
  return jwt.sign({ email: email.toLowerCase().trim(), purpose: EMAIL_TOKEN_PURPOSE }, env.jwtSecret, { expiresIn: '15m' })
}

export function checkEmailToken(emailToken, email) {
  let decoded
  try {
    decoded = jwt.verify(emailToken, env.jwtSecret)
  } catch {
    return false
  }
  return decoded.purpose === EMAIL_TOKEN_PURPOSE && decoded.email === String(email).toLowerCase().trim()
}
