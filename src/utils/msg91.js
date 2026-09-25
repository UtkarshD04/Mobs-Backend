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
//
// MSG91 often reports a failed send (unapproved DLT template, bad sender id,
// no SMS balance, etc.) as an HTTP 200 with `{ type: 'error', message: ... }`
// rather than a non-2xx status, so axios alone won't throw for it — check
// the body explicitly or a rejected/unregistered template silently "sends"
// nothing while the caller still sees a success response.
export async function sendOtp(phone) {
  const { data } = await axios.post(
    BASE_URL,
    { template_id: env.msg91.templateId, mobile: toMsg91Mobile(phone) },
    { headers: { authkey: env.msg91.authKey, 'Content-Type': 'application/json' } }
  )
  if (data?.type !== 'success') {
    const err = new Error(data?.message || 'MSG91 rejected the OTP send request')
    err.status = 502
    throw err
  }
}

export const isSmsConfigured = () => Boolean(env.msg91.authKey && env.msg91.smsTemplateId)

// Sends the DLT-registered outreach template to one 10-digit Indian mobile
// number through MSG91's Flow API. `variables` fill the template's ##name##
// style placeholders. Like the OTP calls, MSG91 can answer HTTP 200 with
// `{ type: 'error' }` (unapproved template, no balance, DND number…), so the
// body is checked rather than trusting the status code. Returns MSG91's
// request id.
export async function sendSmsFlow(phone, variables) {
  const { data } = await axios.post(
    'https://control.msg91.com/api/v5/flow',
    { template_id: env.msg91.smsTemplateId, short_url: '0', recipients: [{ mobiles: toMsg91Mobile(phone), ...variables }] },
    { headers: { authkey: env.msg91.authKey, 'Content-Type': 'application/json', accept: 'application/json' } }
  )
  if (data?.type !== 'success') {
    const err = new Error(data?.message || 'MSG91 rejected the SMS')
    err.status = 502
    throw err
  }
  return data.message ?? null
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
