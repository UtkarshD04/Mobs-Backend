import { env } from '../config/env.js'

// Server-side source of truth for what an employer actually pays — the
// frontend only ever displays this, never computes it. GST_MODE=exclusive
// (the launch default) adds tax on top of amountPaise; GST_MODE=inclusive
// would carve it back out instead, mirroring the employee-subscription
// invoice convention in env.gst.
export function getEmployerPlanPricing() {
  const { planCode, planName, billingPeriod, amountPaise, gstMode, gstRatePercent } = env.employerPlan

  const baseAmountPaise = Math.round(amountPaise)
  let gstAmountPaise
  let totalAmountPaise

  if (gstMode === 'inclusive') {
    gstAmountPaise = Math.round(baseAmountPaise - baseAmountPaise * (100 / (100 + gstRatePercent)))
    totalAmountPaise = baseAmountPaise
  } else {
    gstAmountPaise = Math.round(baseAmountPaise * (gstRatePercent / 100))
    totalAmountPaise = baseAmountPaise + gstAmountPaise
  }

  return {
    planCode,
    planName,
    billingPeriod,
    baseAmountPaise,
    gstMode,
    gstRatePercent,
    gstAmountPaise,
    totalAmountPaise, // what Razorpay actually charges
    currency: 'INR',
  }
}
