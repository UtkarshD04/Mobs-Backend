import { logActivity } from './activityLog.js'
import { grantCredits } from './creditWallet.js'
import { getEmployerPlanCvCredits } from './employerPlanPricing.js'
import { logger } from '../config/logger.js'
import EmployerSubscription from '../models/EmployerSubscription.js'

export const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

// Shared by the verify-payment endpoint (browser round-trip) and the
// Razorpay webhook (server-to-server) so a subscription only ever gets
// activated once no matter which path lands first — mirrors
// creditJobPayment.js's idempotency pattern. Safe to call more than once:
// a subscription already 'active' is left untouched, and the plan's CV
// credits are granted at most once (see grantPlanCvCredits).
export async function activateEmployerSubscription(subscription, payment) {
  if (subscription.status !== 'active') {
    const startsAt = new Date()
    const expiresAt = new Date(startsAt.getTime() + ONE_YEAR_MS)

    subscription.status = 'active'
    subscription.startsAt = startsAt
    subscription.expiresAt = expiresAt
    subscription.razorpayPaymentId = payment.razorpayPaymentId
    subscription.razorpaySignature = payment.razorpaySignature ?? subscription.razorpaySignature
    await subscription.save()

    await logActivity(subscription.company, `${subscription.planName} activated — valid until ${expiresAt.toLocaleDateString('en-IN')}`, 'green')
  }

  // The plan is already paid for and active at this point — a failed credit
  // grant must not make the payment look failed. It stays ungranted
  // (cvCreditsGranted: null), so scripts/grant-plan-cv-credits.js picks it up.
  await grantPlanCvCredits(subscription).catch((err) => {
    logger.error({ err, subscriptionId: subscription._id.toString() }, 'Failed to grant plan CV credits')
  })

  return subscription
}

// Adds the plan tier's included CV credits to the company's wallet, once per
// subscription period. The guard is an atomic claim on the subscription
// itself (cvCreditsGranted: null -> n), same compare-and-swap idea as
// creditWallet.activateCvCreditPurchase, so verify + webhook racing each
// other (or the backfill script re-running) can never double-grant. Returns
// the number of credits granted by this call — 0 when there was nothing to do.
export async function grantPlanCvCredits(subscription) {
  const credits = getEmployerPlanCvCredits(subscription.planCode)
  if (!credits || credits < 1) return 0

  const claimed = await EmployerSubscription.findOneAndUpdate(
    { _id: subscription._id, status: 'active', cvCreditsGranted: null },
    { $set: { cvCreditsGranted: credits } },
    { new: true }
  )
  if (!claimed) return 0

  try {
    await grantCredits(claimed.company, {
      delta: credits,
      type: 'purchase',
      referenceType: 'EmployerSubscription',
      referenceId: claimed._id,
      description: `Included with ${claimed.planName} — ${credits} CV credits`,
    })
  } catch (err) {
    // Release the claim so a retry can grant them.
    await EmployerSubscription.updateOne({ _id: claimed._id }, { $set: { cvCreditsGranted: null } })
    throw err
  }
  subscription.cvCreditsGranted = credits

  try {
    await logActivity(claimed.company, `${credits} CV credits added with ${claimed.planName}`, 'green')
  } catch (err) {
    logger.warn({ err }, 'Failed to log company activity for plan CV credits')
  }

  return credits
}
