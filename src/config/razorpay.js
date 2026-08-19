import Razorpay from 'razorpay'
import { env } from './env.js'

let client = null

export function isRazorpayConfigured() {
  return Boolean(env.razorpayKeyId && env.razorpayKeySecret)
}

// Lazy singleton: constructed on first use rather than at import time, so a
// server without Razorpay configured can still boot and serve every route
// that isn't payments — it only fails once a payment endpoint is actually hit.
export function getRazorpayClient() {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    const err = new Error('Payments are not configured on this server')
    err.status = 503
    throw err
  }
  if (!client) {
    client = new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret })
  }
  return client
}
