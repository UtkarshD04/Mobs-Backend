import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// Append-only audit trail for every change to an employer's CV-credit
// balance. Never updated or deleted after creation — an admin correction is
// always a new 'admin_add'/'admin_deduct' row, never an edit to history (see
// staffCvCreditController.js). CvCreditSubscription.remainingCredits must
// always equal the running sum of `delta` for that company; creditWallet.js
// is the only place both are written, always together.
const creditLedgerSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    type: { type: String, enum: ['purchase', 'cv_unlock', 'refund', 'admin_add', 'admin_deduct', 'expiry'], required: true, index: true },
    delta: { type: Number, required: true }, // positive for grants, negative for spends
    balanceAfter: { type: Number, required: true, min: 0 },
    referenceType: { type: String, default: null }, // e.g. 'Payment', 'CandidateUnlock', 'StaffUser'
    referenceId: { type: Schema.Types.ObjectId, default: null },
    description: { type: String, default: '' },
    // Set only for admin_add/admin_deduct — who made the manual adjustment.
    performedBy: { type: Schema.Types.ObjectId, ref: 'StaffUser', default: null },
  },
  { timestamps: true }
)

creditLedgerSchema.index({ company: 1, createdAt: -1 })

applyIdTransform(creditLedgerSchema, { company: 'companyId', performedBy: 'performedById' })

export default model('CreditLedger', creditLedgerSchema)
