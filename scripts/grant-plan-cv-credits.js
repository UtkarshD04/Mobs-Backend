// One-off backfill — gives the plan-included CV credits to employer plans
// that were activated before plans came with credits. Run from Backend/ with:
//   node scripts/grant-plan-cv-credits.js           (dry run: only lists)
//   node scripts/grant-plan-cv-credits.js --apply   (actually grants)
// Safe to re-run: each subscription is granted at most once (see
// grantPlanCvCredits in src/utils/activateEmployerSubscription.js).
import 'dotenv/config'
import mongoose from 'mongoose'
import EmployerSubscription from '../src/models/EmployerSubscription.js'
import { grantPlanCvCredits } from '../src/utils/activateEmployerSubscription.js'
import { getEmployerPlanCvCredits } from '../src/utils/employerPlanPricing.js'

const apply = process.argv.includes('--apply')

await mongoose.connect(process.env.MONGO_URI)

const subscriptions = await EmployerSubscription.find({
  status: 'active',
  expiresAt: { $gt: new Date() },
  cvCreditsGranted: null,
}).sort({ createdAt: 1 })

let granted = 0
let skipped = 0
let failed = 0
for (const sub of subscriptions) {
  const credits = getEmployerPlanCvCredits(sub.planCode)
  const label = `${sub._id} company=${sub.company} plan=${sub.planCode}`
  if (!credits) {
    console.log(`skip  ${label} (no credits configured for this plan code)`)
    skipped += 1
    continue
  }
  if (!apply) {
    console.log(`would grant ${credits}  ${label}`)
    continue
  }
  try {
    const n = await grantPlanCvCredits(sub)
    console.log(`${n ? `granted ${n}` : 'already granted'}  ${label}`)
    if (n) granted += 1
  } catch (err) {
    console.error(`FAILED ${label}: ${err.message}`)
    failed += 1
  }
}

console.log(`\n${subscriptions.length} active plan(s) without credits — ${apply ? `granted: ${granted}, skipped: ${skipped}, failed: ${failed}` : `dry run (skipped: ${skipped}); re-run with --apply to grant`}`)
await mongoose.disconnect()
process.exit(failed ? 1 : 0)
