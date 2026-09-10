import { logActivity } from './activityLog.js'

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

// Shared by the verify-payment endpoint (browser round-trip) and the
// Razorpay webhook (server-to-server) so a subscription only ever gets
// activated once no matter which path lands first — mirrors
// creditJobPayment.js's idempotency pattern. Safe to call more than once:
// a subscription already 'active' is left untouched.
export async function activateEmployerSubscription(subscription, payment) {
  if (subscription.status === 'active') return subscription

  const startsAt = new Date()
  const expiresAt = new Date(startsAt.getTime() + ONE_YEAR_MS)

  subscription.status = 'active'
  subscription.startsAt = startsAt
  subscription.expiresAt = expiresAt
  subscription.razorpayPaymentId = payment.razorpayPaymentId
  subscription.razorpaySignature = payment.razorpaySignature ?? subscription.razorpaySignature
  await subscription.save()

  await logActivity(subscription.company, `${subscription.planName} activated — valid until ${expiresAt.toLocaleDateString('en-IN')}`, 'green')

  return subscription
}
