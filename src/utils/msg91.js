import axios from 'axios'
import { env } from '../config/env.js'

const BASE_URL = 'https://control.msg91.com/api/v5/otp'

// MSG91 wants the number with country code and no leading '+' (e.g. 919876543210).
function toMsg91Mobile(phone) {
  return `91${phone.trim()}`
}

// Asks MSG91 to generate and text an OTP to the given 10-digit Indian mobile
// number. MSG91 owns OTP generation/expiry/retry itself — we never see the
// code, only pass/fail on send and later verify.
export async function sendOtp(phone) {
  await axios.post(
    BASE_URL,
    { template_id: env.msg91.templateId, mobile: toMsg91Mobile(phone) },
    { headers: { authkey: env.msg91.authKey, 'Content-Type': 'application/json' } }
  )
}

// Returns true if MSG91 confirms the code, false for a wrong/expired code.
// Any other failure (bad auth key, network) throws so the caller 500s
// instead of silently treating it as a wrong OTP.
export async function verifyOtp(phone, otp) {
  try {
    const { data } = await axios.post(
      `${BASE_URL}/verify`,
      null,
      { params: { otp, mobile: toMsg91Mobile(phone) }, headers: { authkey: env.msg91.authKey } }
    )
    return data?.type === 'success'
  } catch (err) {
    if (err.response?.data?.type === 'error') return false
    throw err
  }
}

// The MSG91 OTP *widget* (used by the website, not the mobile app) verifies
// the code client-side and hands back a signed access-token. That token is
// only trustworthy once MSG91 itself confirms it server-to-server — this
// returns the verified identifier (mobile/email) on success, or null for an
// invalid/expired token.
export async function verifyWidgetAccessToken(accessToken) {
  try {
    const { data } = await axios.post(
      'https://control.msg91.com/api/v5/widget/verifyAccessToken',
      { authkey: env.msg91.authKey, 'access-token': accessToken },
      { headers: { 'Content-Type': 'application/json' } }
    )
    return data?.type === 'success' ? data.message : null
  } catch (err) {
    if (err.response?.data?.type === 'error') return null
    throw err
  }
}
