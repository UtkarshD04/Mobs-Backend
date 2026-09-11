import CreditPlan from '../models/CreditPlan.js'

// The one configuration file the business rule lives in: ₹25/credit, and the
// three launch packs. Seeded into the DB (CreditPlan) on first read so admins
// can then edit price/credits/active-state from the admin panel without a
// deploy — this file only supplies the *defaults* a fresh install starts from.
export const RUPEES_PER_CV_CREDIT = 25

export const DEFAULT_CV_CREDIT_PLANS = [
  { code: 'CV_STARTER_50', name: 'Starter', amountPaise: 125000, creditsGranted: 50, sortOrder: 1 },
  { code: 'CV_GROWTH_100', name: 'Growth', amountPaise: 250000, creditsGranted: 100, sortOrder: 2 },
  { code: 'CV_BUSINESS_200', name: 'Business', amountPaise: 500000, creditsGranted: 200, sortOrder: 3 },
]

let seedPromise = null

// Idempotent — safe to call on every request. `findOneAndUpdate` with
// `upsert` per plan means a second server instance racing this same seed
// just no-ops on the duplicate key rather than erroring.
async function ensureDefaultPlansSeeded() {
  if (seedPromise) return seedPromise
  seedPromise = (async () => {
    const count = await CreditPlan.estimatedDocumentCount()
    if (count > 0) return
    for (const plan of DEFAULT_CV_CREDIT_PLANS) {
      await CreditPlan.findOneAndUpdate({ code: plan.code }, { $setOnInsert: plan }, { upsert: true })
    }
  })()
  return seedPromise
}

export async function getActiveCvCreditPlans() {
  await ensureDefaultPlansSeeded()
  return CreditPlan.find({ isActive: true }).sort({ sortOrder: 1, amountPaise: 1 })
}

export async function getCvCreditPlanById(planId) {
  await ensureDefaultPlansSeeded()
  return CreditPlan.findOne({ _id: planId, isActive: true })
}

export function rupeesPerCredit(plan) {
  return Math.round(plan.amountPaise / 100 / plan.creditsGranted)
}
