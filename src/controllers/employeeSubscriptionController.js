import { asyncHandler } from '../utils/asyncHandler.js'
import { getRazorpayClient, isRazorpayConfigured } from '../config/razorpay.js'
import { verifyOrderPaymentSignature } from '../utils/razorpaySignature.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import Employee from '../models/Employee.js'
import Payment from '../models/Payment.js'

const DEFAULT_FEE = 99

export const getSubscription = asyncHandler(async (req, res) => {
  res.json(req.employee.subscription)
})

// When Razorpay isn't configured (no keys in env — the case on a fresh dev
// checkout), orders are created locally instead of on Razorpay's servers so
// the rest of the flow can still be exercised end to end. The `mock: true`
// flag tells the client to skip the Checkout widget and call the
// mock-confirm endpoint directly instead of the signature-verified one.
function buildOrder(amount, receipt) {
  if (!isRazorpayConfigured()) {
    return { orderId: `mock_${receipt}`, amount: Math.round(amount * 100), currency: 'INR', mock: true }
  }
  return null // caller creates the real order
}

// Creates a Razorpay order for the fixed, server-side subscription fee.
// The amount never comes from the client — only the order id it returns.
export const createSubscriptionOrder = asyncHandler(async (req, res) => {
  const employee = req.employee
  if (employee.subscription.status === 'paid') {
    return res.status(409).json({ message: 'Subscription is already active' })
  }

  const amount = employee.subscription.amount ?? DEFAULT_FEE
  const receipt = `sub_${employee._id}_${Date.now()}`

  let order = buildOrder(amount, receipt)
  if (!order) {
    const rzpOrder = await getRazorpayClient().orders.create({
      amount: Math.round(amount * 100), // paise
      currency: 'INR',
      receipt,
      notes: { purpose: 'employee_subscription', employeeId: employee._id.toString() },
    })
    order = { orderId: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, mock: false }
  }

  await Payment.create({
    purpose: 'employee_subscription',
    employee: employee._id,
    razorpayOrderId: order.orderId,
    amount,
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
    description: 'Placement Support Programme — one-time fee',
    prefill: { name: employee.name, email: employee.email, contact: employee.phone || undefined },
  })
})

// Guest variants of the two handlers above, for the "pay before you sign up"
// flow on the marketing site: no employee exists yet, so the order/payment
// aren't linked to one. The order is claimed by whichever new account is
// created with its id next (see employeeAuthController.signup) — until then
// it just sits on the Payment record with employee: null.
export const createGuestSubscriptionOrder = asyncHandler(async (req, res) => {
  const amount = DEFAULT_FEE
  const receipt = `guest_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  let order = buildOrder(amount, receipt)
  if (!order) {
    const rzpOrder = await getRazorpayClient().orders.create({
      amount: Math.round(amount * 100), // paise
      currency: 'INR',
      receipt,
      notes: { purpose: 'employee_subscription_guest' },
    })
    order = { orderId: rzpOrder.id, amount: rzpOrder.amount, currency: rzpOrder.currency, mock: false }
  }

  await Payment.create({
    purpose: 'employee_subscription',
    employee: null,
    razorpayOrderId: order.orderId,
    amount,
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
    description: 'Placement Support Programme — one-time fee',
  })
})

// Confirms the checkout redirect result. Signature verification alone proves
// the payment came from Razorpay for this exact order; the payments.fetch
// call is a belt-and-braces check that it actually settled as 'captured'
// before we credit the account.
export const verifyGuestSubscriptionPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {}
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ message: 'Missing payment details' })
  }

  const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id, purpose: 'employee_subscription', employee: null })
  if (!payment) return res.status(404).json({ message: 'Order not found' })

  if (payment.status === 'paid') {
    return res.json({ paymentOrderId: payment.razorpayOrderId })
  }
  if (payment.status !== 'created') {
    return res.status(400).json({ message: 'This order can no longer be verified' })
  }

  if (!verifyOrderPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    payment.status = 'failed'
    await payment.save()
    logger.warn({ orderId: razorpay_order_id }, 'Razorpay signature verification failed (guest subscription)')
    return res.status(400).json({ message: 'Payment verification failed' })
  }

  const captured = await getRazorpayClient().payments.fetch(razorpay_payment_id)
  if (captured.order_id !== razorpay_order_id || captured.status !== 'captured') {
    payment.status = 'failed'
    await payment.save()
    return res.status(400).json({ message: 'Payment was not captured' })
  }

  payment.razorpayPaymentId = razorpay_payment_id
  payment.razorpaySignature = razorpay_signature
  payment.status = 'paid'
  payment.paidAt = new Date()
  await payment.save()

  res.json({ paymentOrderId: payment.razorpayOrderId })
})

export const verifySubscriptionPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {}
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ message: 'Missing payment details' })
  }

  const employee = req.employee
  const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id, employee: employee._id })
  if (!payment) return res.status(404).json({ message: 'Order not found' })

  if (payment.status === 'paid') {
    return res.json(employee.subscription)
  }
  if (payment.status !== 'created') {
    return res.status(400).json({ message: 'This order can no longer be verified' })
  }

  if (!verifyOrderPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    payment.status = 'failed'
    await payment.save()
    logger.warn({ orderId: razorpay_order_id, employeeId: employee._id.toString() }, 'Razorpay signature verification failed')
    return res.status(400).json({ message: 'Payment verification failed' })
  }

  const captured = await getRazorpayClient().payments.fetch(razorpay_payment_id)
  if (captured.order_id !== razorpay_order_id || captured.status !== 'captured') {
    payment.status = 'failed'
    await payment.save()
    return res.status(400).json({ message: 'Payment was not captured' })
  }

  payment.razorpayPaymentId = razorpay_payment_id
  payment.razorpaySignature = razorpay_signature
  payment.status = 'paid'
  payment.paidAt = new Date()
  await payment.save()

  employee.subscription = { status: 'paid', amount: payment.amount, paidOn: payment.paidAt }
  await employee.save()

  res.json(employee.subscription)
})

// Dev-only shortcut: confirms a mock order (created because Razorpay wasn't
// configured) without any signature or Razorpay API round-trip. Refuses to
// touch anything that isn't actually flagged isMock, so it can't be used to
// wave through a real payment.
async function confirmMock(orderId, employeeFilter) {
  const payment = await Payment.findOne({ razorpayOrderId: orderId, purpose: 'employee_subscription', isMock: true, ...employeeFilter })
  if (!payment) return { error: 404, message: 'Mock order not found' }
  if (payment.status === 'created') {
    payment.status = 'paid'
    payment.razorpayPaymentId = `mock_payment_${Date.now()}`
    payment.paidAt = new Date()
    await payment.save()
  }
  return { payment }
}

export const confirmMockSubscriptionPayment = asyncHandler(async (req, res) => {
  const { orderId } = req.body ?? {}
  if (!orderId) return res.status(400).json({ message: 'orderId is required' })

  const { error, message, payment } = await confirmMock(orderId, { employee: req.employee._id })
  if (error) return res.status(error).json({ message })

  const employee = req.employee
  employee.subscription = { status: 'paid', amount: payment.amount, paidOn: payment.paidAt }
  await employee.save()

  res.json(employee.subscription)
})

export const confirmGuestMockSubscriptionPayment = asyncHandler(async (req, res) => {
  const { orderId } = req.body ?? {}
  if (!orderId) return res.status(400).json({ message: 'orderId is required' })

  const { error, message, payment } = await confirmMock(orderId, { employee: null })
  if (error) return res.status(error).json({ message })

  res.json({ paymentOrderId: payment.razorpayOrderId })
})
