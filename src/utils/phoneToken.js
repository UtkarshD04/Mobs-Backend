import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

const PHONE_TOKEN_PURPOSE = 'phone-verify'

// Shared by employee and employer phone-OTP verification (both MSG91
// widget-based) — a phoneToken just attests "this phone was verified",
// independent of which side is signing up, so one JWT shape covers both.
export function issuePhoneToken(phone) {
  return jwt.sign({ phone, purpose: PHONE_TOKEN_PURPOSE }, env.jwtSecret, { expiresIn: '15m' })
}

// Confirms `phoneToken` (minted by issuePhoneToken) actually attests to
// `phone` before letting signup proceed — a signup can't just claim a
// phone was verified, it has to present the token that proves it.
export function checkPhoneToken(phoneToken, phone) {
  let decoded
  try {
    decoded = jwt.verify(phoneToken, env.jwtSecret)
  } catch {
    return false
  }
  return decoded.purpose === PHONE_TOKEN_PURPOSE && decoded.phone === phone
}
