import crypto from 'node:crypto'
import { env } from '../config/env.js'

// Mobile OTPs sent through the SMS API: 6 digits, valid for 10 minutes, at most 5 wrong guesses,
// and no new code within 30 seconds of the last one. Same rules as the email codes.
export const PHONE_OTP_TTL_MS = 10 * 60 * 1000
export const PHONE_OTP_MAX_ATTEMPTS = 5
export const PHONE_OTP_RESEND_MS = 30 * 1000

export function generatePhoneOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

// Keyed with the server secret and bound to the number, so a stolen row can't be brute-forced
// offline without the secret, or replayed for a different number.
export function hashPhoneOtp(phone, code) {
  return crypto.createHmac('sha256', env.jwtSecret).update(`${phone.trim()}:${code}`).digest('hex')
}

export function phoneOtpMatches(phone, code, codeHash) {
  const a = Buffer.from(hashPhoneOtp(phone, code), 'hex')
  const b = Buffer.from(String(codeHash), 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
