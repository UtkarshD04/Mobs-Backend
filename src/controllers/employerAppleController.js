import { asyncHandler } from '../utils/asyncHandler.js'
import { verifyAppleTransaction } from '../utils/appleTransaction.js'
import { processApplePurchase } from '../utils/appleIap.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

// POST /api/employer/payments/apple — iOS in-app purchase of an annual plan or a CV-credit pack.
// The app sends the signed transaction (JWS) StoreKit gave it; it is verified against Apple's
// root certificate, so nothing the client says about the product or price is trusted. Sandbox
// transactions are accepted too (App Review and TestFlight buy in the sandbox).
export const verifyAppleEmployerPurchase = asyncHandler(async (req, res) => {
  let tx
  try {
    tx = verifyAppleTransaction(req.body?.signedTransaction)
  } catch (err) {
    logger.warn({ companyId: req.company._id.toString(), reason: err.message }, 'Apple transaction rejected')
    return res.status(400).json({ message: 'Could not verify this purchase with the App Store.' })
  }
  if (tx.bundleId !== env.appleEmployerBundleId) return res.status(400).json({ message: 'This purchase is not for the Mzobs employer app.' })
  if (tx.revocationDate) return res.status(400).json({ message: 'This purchase was refunded.' })

  const result = await processApplePurchase({
    companyId: req.company._id,
    productId: tx.productId,
    transactionId: tx.transactionId,
    purchaseDate: tx.purchaseDate,
    // StoreKit reports the price in thousandths of the currency.
    price: typeof tx.price === 'number' ? tx.price / 1000 : undefined,
    currency: tx.currency,
  })
  if (result.granted) return res.json(result)
  logger.error({ companyId: req.company._id.toString(), productId: tx.productId, transactionId: tx.transactionId, ...result }, 'Apple purchase not granted')
  res.status(result.ignored === 'unknown product' ? 400 : 409).json({ message: 'This purchase could not be applied to your account. Please contact support.' })
})
