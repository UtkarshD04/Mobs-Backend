import { env } from '../config/env.js'

// Server-side source of truth for what an employer actually pays — the
// frontend only ever displays this, never computes it. GST_MODE=exclusive
// (the launch default) adds tax on top of amountPaise; GST_MODE=inclusive
// would carve it back out instead, mirroring the employee-subscription
// invoice convention in env.gst. Shared by every tier in env.employerPlan.plans.
function priceOne(planDef) {
  const { billingPeriod, gstMode, gstRatePercent } = env.employerPlan
  const { planCode, planName, amountPaise, cvCredits, benefits } = planDef

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
    cvCredits,
    benefits: cvCredits > 0 ? [`${cvCredits} CV credits included`, ...benefits] : benefits,
  }
}

// Every purchasable employer plan tier, priced. Powers the Plans & Billing
// page's plan-picker.
export function getEmployerPlans() {
  return env.employerPlan.plans.map(priceOne)
}

// One priced tier by code — used at order-creation time (never trusts a
// price the client sends) and by the guest-checkout flow, which has no plan
// picker and always defaults to the first (base) tier.
export function getEmployerPlanPricing(planCode) {
  const def = (planCode && env.employerPlan.plans.find((p) => p.planCode === planCode)) || env.employerPlan.plans[0]
  return priceOne(def)
}

// CV credits a tier includes, by exact code — no fallback to the base tier,
// so a subscription on a retired/unknown code gets null instead of a guess.
export function getEmployerPlanCvCredits(planCode) {
  const def = env.employerPlan.plans.find((p) => p.planCode === planCode)
  return def ? def.cvCredits : null
}
