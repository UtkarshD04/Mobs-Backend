import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// One row per employer — the employer's running CV-credit wallet. Unlike
// EmployerSubscription (one document per annual period, because only one
// period is ever "current"), credit packs stack: an employer can buy Starter
// then later top up with Growth, and both grants land in the same spendable
// balance. So this is a single aggregate row (unique per company), not a
// per-purchase row — per-purchase history lives on Payment
// (purpose: 'employer_cv_credit') and every balance-changing event lives on
// CreditLedger, which this row's remainingCredits must always agree with
// (see creditWallet.js — every mutation here is paired with a ledger write).
const cvCreditSubscriptionSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, unique: true, index: true },
    // Display-only — name of the most recently purchased plan, so the
    // dashboard header has something human-readable to show.
    planName: { type: String, default: null },
    planCode: { type: String, default: null },
    // Cumulative totals across every purchase this employer has ever made.
    amountPaid: { type: Number, default: 0 }, // paise, cumulative
    totalCredits: { type: Number, default: 0 }, // cumulative credits ever granted (purchase + admin_add)
    usedCredits: { type: Number, default: 0 }, // cumulative credits ever spent (cv_unlock + admin_deduct)
    remainingCredits: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active', index: true },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    // Most recent Payment that funded this wallet — audit convenience only,
    // the real purchase history is the Payment collection.
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
  },
  { timestamps: true }
)

applyIdTransform(cvCreditSubscriptionSchema, { company: 'companyId', payment: 'paymentId' })

export default model('CvCreditSubscription', cvCreditSubscriptionSchema)
