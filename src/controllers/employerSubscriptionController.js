import { asyncHandler } from '../utils/asyncHandler.js'
import { getRazorpayClient, isRazorpayConfigured } from '../config/razorpay.js'
import { verifyOrderPaymentSignature } from '../utils/razorpaySignature.js'
import { getEmployerPlans, getEmployerPlanPricing } from '../utils/employerPlanPricing.js'
import { getEffectiveSubscription } from '../utils/employerSubscriptionAccess.js'
import { activateEmployerSubscription } from '../utils/activateEmployerSubscription.js'
import { findApplicableCoupon, computeDiscount, incrementCouponUsage, CouponError } from '../utils/coupon.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import EmployerSubscription from '../models/EmployerSubscription.js'
import Payment from '../models/Payment.js'

const SUBSCRIPTION_COUPON_PURPOSE = 'employer_subscription'

// Looks up and prices a coupon against a specific plan tier's total price —
// mirrors employerCvCreditController's priceCvCreditPlanWithCoupon. Returns
// null (no coupon requested) or `{ coupon, discountAmount, amountRupees }`
// with `amountRupees` already discounted.
async function priceEmployerPlanWithCoupon(pricing, couponCode) {
  if (!couponCode) return null
  const baseAmountRupees = pricing.totalAmountPaise / 100
  const coupon = await findApplicableCoupon(couponCode, SUBSCRIPTION_COUPON_PURPOSE, baseAmountRupees)
  const discountAmount = computeDiscount(coupon, baseAmountRupees)
  return { coupon, discountAmount, amountRupees: Math.round((baseAmountRupees - discountAmount) * 100) / 100 }
}

// GET /api/employer/subscription — current plan state plus every purchasable
// tier's pricing, so the frontend never has to hardcode ₹999/₹1499/₹1999 or
// the GST math.
export const getSubscription = asyncHandler(async (req, res) => {
  const { subscription, isActive } = await getEffectiveSubscription(req.company._id)
  res.json({ subscription, isActive, plans: getEmployerPlans() })
})

// GET /api/employer/subscription/access-status — a lightweight boolean the
// frontend polls before letting the employer post/publish a job or open a
// resume, so the UI can redirect to /subscription instead of firing a
// request that's just going to 403. The backend re-checks independently on
// every gated route regardless of what this returns.
export const getAccessStatus = asyncHandler(async (req, res) => {
  const { subscription, isActive } = await getEffectiveSubscription(req.company._id)
  res.json({
    active: isActive,
    status: subscription?.status ?? 'none',
    expiresAt: subscription?.expiresAt ?? null,
    planName: subscription?.planName ?? null,
  })
})

// When Razorpay isn't configured (dev without keys), simulate the order
// locally — same pattern as employeeSubscriptionController.buildOrder and
// jobController.buildMockOrder. Never allowed in production.
function buildMockOrder(amountPaise, receipt) {
  if (!isRazorpayConfigured() && process.env.NODE_ENV !== 'production') {
    return { orderId: `mock_${receipt}`, amount: amountPaise, currency: 'INR', mock: true }
  }
  return null
}

// POST /api/employer/subscription/guest-order — same as createSubscriptionOrder
// below, but for a visitor who doesn't have a company/account yet (the
// "verify phone, pay, account is created for you" flow off the public
// pricing page). No req.company/req.user — the Payment row is created with
// company: null and only gets attached once guestSubscribeSignup (see
// authController.js) verifies the payment and creates the account.
export const createGuestSubscriptionOrder = asyncHandler(async (req, res) => {
  const pricing = getEmployerPlanPricing()
  const receipt = `empsub_guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  let order = buildMockOrder(pricing.totalAmountPaise, receipt)
  if (!order) {
    const rzpOrder = await getRazorpayClient().orders.create({
      amount: pricing.totalAmountPaise,
      currency: pricing.currency,
      receipt,
      notes: { purpose: 'employer_subscription', guest: 'true', planCode: pricing.planCode },
    })
    order = { orderId: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, mock: false }
  }

  await Payment.create({
    purpose: 'employer_subscription',
    company: null,
    razorpayOrderId: order.orderId,
    amount: order.amount / 100,
    originalAmount: pricing.baseAmountPaise / 100,
    currency: order.currency,
    status: 'created',
    receipt,
    isMock: order.mock,
  })

  res.status(201).json({
    orderId: order.orderId,
    amount: order.amount,
    currency: order.currency,
    mock: order.mock,
    keyId: env.razorpayKeyId,
    name: 'Mzobs',
    description: `${pricing.planName} — 1 year`,
    pricing,
  })
})

// POST /api/employer/subscription/coupon/preview — { planCode, code }. Prices
// a coupon against a specific tier's price without creating an order, so the
// Plans page can show the discounted price as soon as the employer types a
// code. Re-validated independently (and for real) when the order is actually
// created below — this is a preview only, never the source of truth for what
// gets charged.
export const previewSubscriptionCoupon = asyncHandler(async (req, res) => {
  const { planCode, code } = req.body ?? {}
  if (!code) return res.status(400).json({ message: 'Coupon code is required' })
  if (!getEmployerPlans().some((p) => p.planCode === planCode)) {
    return res.status(404).json({ message: 'This plan is not available' })
  }

  const pricing = getEmployerPlanPricing(planCode)
  try {
    const priced = await priceEmployerPlanWithCoupon(pricing, code)
    res.json({
      valid: true,
      code: priced.coupon.code,
      originalAmount: Math.round(pricing.totalAmountPaise / 100),
      discountAmount: priced.discountAmount,
      finalAmount: priced.amountRupees,
    })
  } catch (err) {
    if (err instanceof CouponError) return res.status(400).json({ valid: false, message: err.message })
    throw err
  }
})

// POST /api/employer/subscription/order — { planCode, couponCode? }. Creates
// a Razorpay order for the server-computed price of the chosen plan tier.
// The amount never comes from the client — only which plan (by code) and an
// optional coupon code, which is itself re-validated and re-priced here
// (never trusts the preview alone).
export const createSubscriptionOrder = asyncHandler(async (req, res) => {
  const { isActive } = await getEffectiveSubscription(req.company._id)
  if (isActive) return res.status(409).json({ message: 'Your employer plan is already active' })

  const { planCode, couponCode } = req.body ?? {}
  if (!getEmployerPlans().some((p) => p.planCode === planCode)) {
    return res.status(404).json({ message: 'This plan is not available' })
  }
  const pricing = getEmployerPlanPricing(planCode)

  let priced
  try {
    priced = await priceEmployerPlanWithCoupon(pricing, couponCode)
  } catch (err) {
    if (err instanceof CouponError) return res.status(400).json({ message: err.message })
    throw err
  }
  const amountPaise = priced ? Math.round(priced.amountRupees * 100) : pricing.totalAmountPaise

  const receipt = `empsub_${req.company._id}_${Date.now()}`

  let order = buildMockOrder(amountPaise, receipt)
  if (!order) {
    const rzpOrder = await getRazorpayClient().orders.create({
      amount: amountPaise,
      currency: pricing.currency,
      receipt,
      notes: { purpose: 'employer_subscription', companyId: req.company._id.toString(), planCode: pricing.planCode },
    })
    order = { orderId: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, mock: false }
  }

  // A fresh 'pending' subscription period is opened now and only flipped to
  // 'active' once the payment is actually verified (see verifyPayment /
  // the webhook) — never on the strength of the browser alone.
  const subscription = await EmployerSubscription.create({
    company: req.company._id,
    planCode: pricing.planCode,
    planName: pricing.planName,
    amount: order.amount,
    currency: order.currency,
    billingPeriod: pricing.billingPeriod,
    status: 'pending',
    paymentProvider: 'razorpay',
    razorpayOrderId: order.orderId,
  })

  await Payment.create({
    purpose: 'employer_subscription',
    company: req.company._id,
    employerSubscription: subscription._id,
    razorpayOrderId: order.orderId,
    amount: order.amount / 100, // Payment.amount is rupees, matching every other Payment row
    originalAmount: Math.round(pricing.totalAmountPaise / 100),
    couponCode: priced ? priced.coupon.code : null,
    discountAmount: priced ? priced.discountAmount : 0,
    currency: order.currency,
    status: 'created',
    receipt,
    isMock: order.mock,
  })

  res.status(201).json({
    orderId: order.orderId,
    amount: order.amount,
    currency: order.currency,
    mock: order.mock,
    keyId: env.razorpayKeyId,
    name: 'Mzobs',
    description: `${pricing.planName} — 1 year`,
    prefill: { name: req.user.name, email: req.user.email },
    pricing,
    couponCode: priced ? priced.coupon.code : null,
    discountAmount: priced ? priced.discountAmount : 0,
  })
})

// POST /api/employer/subscription/verify-payment — confirms the checkout
// redirect result. Signature verification proves it came from Razorpay for
// this exact order; payments.fetch is the belt-and-braces check that it
// actually settled as 'captured' before the plan is activated. Idempotent:
// a payment already 'paid' just returns the current state instead of
// re-activating (and re-extending) the subscription.
export const verifySubscriptionPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {}
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ message: 'Missing payment details' })
  }

  const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id, company: req.company._id, purpose: 'employer_subscription' })
  if (!payment) return res.status(404).json({ message: 'Order not found' })

  const subscription = await EmployerSubscription.findById(payment.employerSubscription)
  if (!subscription) return res.status(404).json({ message: 'Subscription not found' })

  if (payment.status === 'paid') {
    return res.json({ subscription })
  }
  if (payment.status !== 'created') {
    return res.status(400).json({ message: 'This order can no longer be verified' })
  }

  if (!verifyOrderPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    payment.status = 'failed'
    await payment.save()
    subscription.status = 'payment_failed'
    await subscription.save()
    logger.warn({ orderId: razorpay_order_id, companyId: req.company._id.toString() }, 'Razorpay signature verification failed (employer subscription)')
    return res.status(400).json({ message: 'Payment verification failed' })
  }

  const captured = await getRazorpayClient().payments.fetch(razorpay_payment_id)
  if (captured.order_id !== razorpay_order_id || captured.status !== 'captured') {
    payment.status = 'failed'
    await payment.save()
    subscription.status = 'payment_failed'
    await subscription.save()
    return res.status(400).json({ message: 'Payment was not captured' })
  }

  payment.razorpayPaymentId = razorpay_payment_id
  payment.razorpaySignature = razorpay_signature
  payment.status = 'paid'
  payment.paidAt = new Date()
  await payment.save()
  await incrementCouponUsage(payment.couponCode)

  await activateEmployerSubscription(subscription, payment)

  res.json({ subscription })
})

// Dev-only shortcut, mirrors jobController.confirmMockJobPayment /
// employeeSubscriptionController.confirmMockSubscriptionPayment. Hard-blocked
// in production; only ever touches payments actually flagged isMock.
export const confirmMockSubscriptionPayment = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(503).json({ message: 'Mock payments are disabled in production' })
  }

  const { orderId } = req.body ?? {}
  if (!orderId) return res.status(400).json({ message: 'orderId is required' })

  const payment = await Payment.findOne({
    razorpayOrderId: orderId,
    purpose: 'employer_subscription',
    company: req.company._id,
    isMock: true,
  })
  if (!payment) return res.status(404).json({ message: 'Mock order not found' })

  const subscription = await EmployerSubscription.findById(payment.employerSubscription)
  if (!subscription) return res.status(404).json({ message: 'Subscription not found' })

  if (payment.status === 'created') {
    payment.status = 'paid'
    payment.razorpayPaymentId = `mock_payment_${Date.now()}`
    payment.paidAt = new Date()
    await payment.save()
    await incrementCouponUsage(payment.couponCode)
  }

  await activateEmployerSubscription(subscription, payment)

  res.json({ subscription })
})

// GET /api/employer/payments — real billing/payment history for the plan
// (not the per-job sourcing-fee payments, which stay on the existing
// /billing endpoints).
export const listSubscriptionPayments = asyncHandler(async (req, res) => {
  const query = { company: req.company._id, purpose: 'employer_subscription' }
  const { data, page, limit, total } = await paginate(Payment, query, paginationParams(req), { sort: { createdAt: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})
