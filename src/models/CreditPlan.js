import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// Admin-editable CV-credit pack catalog — the "one place" pricing lives so
// packs can be added/repriced from the admin panel without a deploy. Amount
// is stored in paise (matches EmployerSubscription.amount) to avoid
// float rupee math; creditsGranted is exactly how many unlock credits the
// pack grants, no proration/GST math involved (the credit price itself,
// ₹25/CV, is the only pricing rule — see cvCreditPlans.js for the default
// seed catalog and getCvCreditPlanRate()).
const creditPlanSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    amountPaise: { type: Number, required: true, min: 1 },
    creditsGranted: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'StaffUser', default: null },
  },
  { timestamps: true }
)

applyIdTransform(creditPlanSchema, { createdBy: 'createdById' })

export default model('CreditPlan', creditPlanSchema)
