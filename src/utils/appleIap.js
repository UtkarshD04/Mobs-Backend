import { Types } from 'mongoose'
import { activateEmployerSubscription } from './activateEmployerSubscription.js'
import { activateCvCreditPurchase } from './creditWallet.js'
import { getEmployerPlans } from './employerPlanPricing.js'
import { logger } from '../config/logger.js'
import Company from '../models/Company.js'
import CreditPlan from '../models/CreditPlan.js'
import EmployerSubscription from '../models/EmployerSubscription.js'
import Payment from '../models/Payment.js'

const PRODUCT_PREFIX = 'com.mzobs.employer.'

// Product ids are derived from the plan / pack code, so nothing extra has to be
// configured per plan: create these exact ids in App Store Connect + RevenueCat.
export const appleProductId = (code) => `${PRODUCT_PREFIX}${String(code).toLowerCase()}`

async function resolveProduct(productId) {
  // getEmployerPlans() imports this module, so it is read lazily here.
  const plan = getEmployerPlans().find((p) => p.appleProductId === productId)
  if (plan) return { kind: 'plan', plan }
  if (!productId?.startsWith(PRODUCT_PREFIX)) return null
  const pack = await CreditPlan.findOne({ code: productId.slice(PRODUCT_PREFIX.length).toUpperCase() })
  return pack ? { kind: 'credits', pack } : null
}

// Grants what an App Store purchase paid for, exactly once per Apple transaction.
// The Payment row (unique `apple_<transactionId>`) is the claim; its 'created' ->
// 'paid' flip lives inside the activate* helpers, so a webhook retry after a crash
// finishes the grant instead of skipping it or doing it twice.
export async function processApplePurchase({ appUserId, productId, transactionId, price, currency }) {
  if (!appUserId || !Types.ObjectId.isValid(appUserId)) return { ignored: 'not a company user id' }
  const company = await Company.findById(appUserId).select('_id')
  if (!company) return { ignored: 'unknown company' }

  const product = await resolveProduct(productId)
  if (!product) {
    logger.error({ productId, transactionId }, 'Apple purchase for an unknown product')
    return { ignored: 'unknown product' }
  }

  const orderId = `apple_${transactionId}`
  const base = { company: company._id, provider: 'apple', razorpayOrderId: orderId, razorpayPaymentId: String(transactionId), currency: currency || 'INR', status: 'created', receipt: orderId }

  let payment = await Payment.findOne({ razorpayOrderId: orderId })
  if (payment && String(payment.company) !== String(company._id)) return { ignored: 'transaction belongs to another company' }

  if (product.kind === 'credits') {
    const { pack } = product
    if (!payment) {
      payment = await Payment.create({ ...base, purpose: 'employer_cv_credit', creditPlan: pack._id, creditsGranted: pack.creditsGranted, amount: price ?? pack.amountPaise / 100 }).catch(dupOr)
    }
    if (payment?.status === 'created') await activateCvCreditPurchase(payment._id, { razorpayPaymentId: String(transactionId) })
    return { granted: 'credits', credits: pack.creditsGranted }
  }

  const { plan } = product
  let subscription = payment?.employerSubscription ? await EmployerSubscription.findById(payment.employerSubscription) : null
  if (!subscription) {
    subscription = await EmployerSubscription.create({
      company: company._id,
      planCode: plan.planCode,
      planName: plan.planName,
      amount: Math.round((price ?? plan.totalAmountPaise / 100) * 100),
      currency: currency || 'INR',
      billingPeriod: plan.billingPeriod,
      status: 'pending',
      paymentProvider: 'apple',
    })
  }
  if (!payment) {
    payment = await Payment.create({ ...base, purpose: 'employer_subscription', employerSubscription: subscription._id, amount: price ?? plan.totalAmountPaise / 100 }).catch(dupOr)
  }
  if (payment?.status === 'created') {
    const claimed = await Payment.findOneAndUpdate({ _id: payment._id, status: 'created' }, { $set: { status: 'paid', paidAt: new Date() } }, { new: true })
    if (claimed) await activateEmployerSubscription(subscription, claimed)
  }
  return { granted: 'plan', planCode: plan.planCode }
}

// Two deliveries of the same transaction can race on the unique orderId.
function dupOr(err) {
  if (err?.code === 11000) return null
  throw err
}
