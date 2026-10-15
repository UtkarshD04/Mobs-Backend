import crypto from 'node:crypto'
import { asyncHandler } from '../utils/asyncHandler.js'
import { processApplePurchase } from '../utils/appleIap.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

// RevenueCat calls this after every App Store purchase (iOS in-app purchases).
// The app logs in to RevenueCat with the company id, so `app_user_id` is the
// buyer. Always answers 200 for events we deliberately skip, so RevenueCat only
// retries (non-2xx) when something actually failed.
export const revenueCatWebhook = asyncHandler(async (req, res) => {
  if (!env.revenueCatWebhookSecret) {
    logger.error('RevenueCat webhook secret not configured — rejecting webhook')
    return res.status(503).end()
  }
  const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!safeEqual(auth, env.revenueCatWebhookSecret)) return res.status(401).json({ message: 'Unauthorized' })

  const event = req.body?.event
  if (!event) return res.status(400).json({ message: 'Missing event' })

  // Consumables (credit packs) and non-renewing subscriptions (annual plans)
  // both arrive as NON_RENEWING_PURCHASE.
  if (event.type === 'NON_RENEWING_PURCHASE' || event.type === 'INITIAL_PURCHASE') {
    const result = await processApplePurchase({
      appUserId: event.app_user_id,
      productId: event.product_id,
      transactionId: event.transaction_id ?? event.id,
      price: event.price_in_purchased_currency,
      currency: event.currency,
    })
    logger.info({ eventType: event.type, productId: event.product_id, environment: event.environment, ...result }, 'RevenueCat purchase processed')
  } else if (event.type === 'CANCELLATION' || event.type === 'REFUND') {
    // Apple refunds need a human decision (credits may already be spent).
    logger.warn({ eventType: event.type, productId: event.product_id, appUserId: event.app_user_id, transactionId: event.transaction_id }, 'RevenueCat refund/cancellation — review manually')
  }

  res.json({ received: true })
})
