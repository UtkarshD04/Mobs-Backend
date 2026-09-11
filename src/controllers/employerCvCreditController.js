import { asyncHandler } from '../utils/asyncHandler.js'
import { getRazorpayClient, isRazorpayConfigured } from '../config/razorpay.js'
import { verifyOrderPaymentSignature } from '../utils/razorpaySignature.js'
import { getActiveCvCreditPlans, rupeesPerCredit, RUPEES_PER_CV_CREDIT } from '../utils/cvCreditPlans.js'
import { getWalletBalance, activateCvCreditPurchase } from '../utils/creditWallet.js'
import { findApplicableCoupon, computeDiscount, CouponError } from '../utils/coupon.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import CandidateUnlock from '../models/CandidateUnlock.js'
import CreditPlan from '../models/CreditPlan.js'
import Payment from '../models/Payment.js'

const CV_CREDIT_COUPON_PURPOSE = 'employer_cv_credit'

// Looks up and prices a coupon against a specific plan's rupee price.
// Returns null (no coupon requested) or `{ coupon, discountAmount, amountRupees }`
// with `amountRupees` already discounted — callers use it in place of the
// plan's base price. Amount is always priced in rupees (matching
// findApplicableCoupon/computeDiscount's existing rupee-based contract from
// the employee-subscription flow) even though CreditPlan stores paise.
async function priceCvCreditPlanWithCoupon(plan, couponCode) {
  if (!couponCode) return null
  const baseAmountRupees = plan.amountPaise / 100
  const coupon = await findApplicableCoupon(couponCode, CV_CREDIT_COUPON_PURPOSE, baseAmountRupees)
  const discountAmount = computeDiscount(coupon, baseAmountRupees)
  return { coupon, discountAmount, amountRupees: Math.round((baseAmountRupees - discountAmount) * 100) / 100 }
}

function serializePlan(plan) {
  return {
    id: plan.id ?? plan._id?.toString(),
    code: plan.code,
    name: plan.name,
    amountPaise: plan.amountPaise,
    amountRupees: Math.round(plan.amountPaise / 100),
    creditsGranted: plan.creditsGranted,
    rupeesPerCredit: rupeesPerCredit(plan),
  }
}

// GET /api/employer/credits — current CV-credit balance, source of truth is
// the DB (CvCreditSubscription), never anything the frontend cached.
export const getCreditBalance = asyncHandler(async (req, res) => {
  const wallet = await getWalletBalance(req.company._id)
  res.json({ wallet, rupeesPerCredit: RUPEES_PER_CV_CREDIT })
})

// GET /api/employer/plans — the purchasable CV-credit packs.
export const listCreditPlans = asyncHandler(async (req, res) => {
  const plans = await getActiveCvCreditPlans()
  res.json({ plans: plans.map(serializePlan), rupeesPerCredit: RUPEES_PER_CV_CREDIT })
})

function buildMockOrder(amountPaise, receipt) {
  if (!isRazorpayConfigured() && process.env.NODE_ENV !== 'production') {
    return { orderId: `mock_${receipt}`, amount: amountPaise, currency: 'INR', mock: true }
  }
  return null
}

// POST /api/employer/payments/coupon/preview — prices a coupon against a
// specific plan without creating an order, so the CV Credits page can show
// the discounted price as soon as the employer types a code. Re-validated
// independently (and for real) when the order is actually created below —
// this is a preview only, never the source of truth for what gets charged.
export const previewCvCreditCoupon = asyncHandler(async (req, res) => {
  const { planId, code } = req.body ?? {}
  if (!planId) return res.status(400).json({ message: 'planId is required' })
  if (!code) return res.status(400).json({ message: 'Coupon code is required' })

  const plan = await CreditPlan.findOne({ _id: planId, isActive: true })
  if (!plan) return res.status(404).json({ message: 'This CV-credit plan is not available' })

  try {
    const priced = await priceCvCreditPlanWithCoupon(plan, code)
    res.json({
      valid: true,
      code: priced.coupon.code,
      originalAmount: Math.round(plan.amountPaise / 100),
      discountAmount: priced.discountAmount,
      finalAmount: priced.amountRupees,
    })
  } catch (err) {
    if (err instanceof CouponError) return res.status(400).json({ valid: false, message: err.message })
    throw err
  }
})

// POST /api/employer/payments/create-order — { planId, couponCode? }. The
// amount and credit count are always read server-side from the CreditPlan
// document; nothing about price ever comes from the request body except an
// optional coupon code, which is itself re-validated and re-priced here
// (never trusts a discount amount the client might send).
export const createCvCreditOrder = asyncHandler(async (req, res) => {
  const { planId, couponCode } = req.body ?? {}
  if (!planId) return res.status(400).json({ message: 'planId is required' })

  const plan = await CreditPlan.findOne({ _id: planId, isActive: true })
  if (!plan) return res.status(404).json({ message: 'This CV-credit plan is not available' })

  let priced
  try {
    priced = await priceCvCreditPlanWithCoupon(plan, couponCode)
  } catch (err) {
    if (err instanceof CouponError) return res.status(400).json({ message: err.message })
    throw err
  }
  const amountPaise = priced ? Math.round(priced.amountRupees * 100) : plan.amountPaise

  const receipt = `cvcredit_${req.company._id}_${Date.now()}`

  let order = buildMockOrder(amountPaise, receipt)
  if (!order) {
    const rzpOrder = await getRazorpayClient().orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes: { purpose: 'employer_cv_credit', companyId: req.company._id.toString(), planCode: plan.code },
    })
    order = { orderId: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, mock: false }
  }

  const payment = await Payment.create({
    purpose: 'employer_cv_credit',
    company: req.company._id,
    creditPlan: plan._id,
    creditsGranted: plan.creditsGranted,
    razorpayOrderId: order.orderId,
    amount: order.amount / 100, // Payment.amount is rupees, matching every other Payment row
    originalAmount: priced ? Math.round(plan.amountPaise / 100) : null,
    couponCode: priced ? priced.coupon.code : null,
    discountAmount: priced ? priced.discountAmount : 0,
    currency: order.currency,
    status: 'created',
    receipt,
    isMock: order.mock,
  })

  logger.info({ companyId: req.company._id.toString(), planCode: plan.code, paymentId: payment._id.toString(), couponCode: payment.couponCode }, 'CV credit order created')

  res.status(201).json({
    orderId: order.orderId,
    amount: order.amount,
    currency: order.currency,
    mock: order.mock,
    keyId: env.razorpayKeyId,
    name: 'Mzobs',
    description: `${plan.name} — ${plan.creditsGranted} CV credits`,
    prefill: { name: req.user.name, email: req.user.email },
    plan: serializePlan(plan),
    couponCode: payment.couponCode,
    discountAmount: payment.discountAmount,
  })
})

// POST /api/employer/payments/verify — verifies the Razorpay checkout
// signature, confirms the payment actually captured, then activates the
// purchase exactly once (see activateCvCreditPurchase — idempotent against
// this endpoint being retried and against the webhook landing first).
export const verifyCvCreditPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {}
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ message: 'Missing payment details' })
  }

  const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id, company: req.company._id, purpose: 'employer_cv_credit' })
  if (!payment) return res.status(404).json({ message: 'Order not found' })

  if (payment.status === 'paid') {
    const wallet = await getWalletBalance(req.company._id)
    return res.json({ wallet })
  }
  if (payment.status !== 'created') {
    return res.status(400).json({ message: 'This order can no longer be verified' })
  }

  if (!verifyOrderPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    await Payment.updateOne({ _id: payment._id, status: 'created' }, { $set: { status: 'failed' } })
    logger.warn({ orderId: razorpay_order_id, companyId: req.company._id.toString() }, 'Razorpay signature verification failed (CV credit purchase)')
    return res.status(400).json({ message: 'Payment verification failed' })
  }

  const captured = await getRazorpayClient().payments.fetch(razorpay_payment_id)
  if (captured.order_id !== razorpay_order_id || captured.status !== 'captured') {
    await Payment.updateOne({ _id: payment._id, status: 'created' }, { $set: { status: 'failed' } })
    return res.status(400).json({ message: 'Payment was not captured' })
  }

  await activateCvCreditPurchase(payment._id, { razorpayPaymentId: razorpay_payment_id, razorpaySignature: razorpay_signature })

  const wallet = await getWalletBalance(req.company._id)
  res.json({ wallet })
})

// Dev-only shortcut when Razorpay isn't configured — mirrors
// confirmMockSubscriptionPayment. Hard-blocked in production.
export const confirmMockCvCreditPayment = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(503).json({ message: 'Mock payments are disabled in production' })
  }

  const { orderId } = req.body ?? {}
  if (!orderId) return res.status(400).json({ message: 'orderId is required' })

  const payment = await Payment.findOne({ razorpayOrderId: orderId, purpose: 'employer_cv_credit', company: req.company._id, isMock: true })
  if (!payment) return res.status(404).json({ message: 'Mock order not found' })

  await activateCvCreditPurchase(payment._id, { razorpayPaymentId: `mock_payment_${Date.now()}` })

  const wallet = await getWalletBalance(req.company._id)
  res.json({ wallet })
})

// GET /api/employer/unlocks — paginated CV-unlock history for this employer.
export const listUnlocks = asyncHandler(async (req, res) => {
  const query = { company: req.company._id }
  const { data, page, limit, total } = await paginate(CandidateUnlock, query, paginationParams(req), {
    sort: { createdAt: -1 },
    populate: [{ path: 'candidate', select: 'name headline appliedFor' }, { path: 'job', select: 'title' }],
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

// GET /api/employer/payments (cv-credit purchases only) — purchase history
// table for the CV Credits page. Kept separate from
// listSubscriptionPayments (employer_subscription) so the two payment
// surfaces don't mix rows.
export const listCvCreditPayments = asyncHandler(async (req, res) => {
  const query = { company: req.company._id, purpose: 'employer_cv_credit' }
  const { data, page, limit, total } = await paginate(Payment, query, paginationParams(req), { sort: { createdAt: -1 }, populate: { path: 'creditPlan', select: 'name code creditsGranted' } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})
