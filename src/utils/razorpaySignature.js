import crypto from 'crypto'
import { env } from '../config/env.js'

function timingSafeEqualStrings(expected, actual) {
  const a = Buffer.from(expected)
  const b = Buffer.from(String(actual ?? ''))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Checkout redirect signature: HMAC-SHA256 of "order_id|payment_id" keyed by
// the account's key secret. Proves the payment result came from Razorpay for
// this exact order — the client can't forge it without the secret.
export function verifyOrderPaymentSignature(orderId, paymentId, signature) {
  if (!env.razorpayKeySecret) return false
  const expected = crypto.createHmac('sha256', env.razorpayKeySecret).update(`${orderId}|${paymentId}`).digest('hex')
  return timingSafeEqualStrings(expected, signature)
}

// Webhook signature: HMAC-SHA256 of the raw request body keyed by the
// separate webhook secret. Must run on the unparsed body, before any JSON
// parsing touches it.
export function verifyWebhookSignature(rawBody, signature) {
  if (!env.razorpayWebhookSecret) return false
  const expected = crypto.createHmac('sha256', env.razorpayWebhookSecret).update(rawBody).digest('hex')
  return timingSafeEqualStrings(expected, signature)
}
