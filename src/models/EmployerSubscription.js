import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// One document per purchase/renewal cycle (not a single overwritten
// subdocument on Company) — an annual plan renews into a new period each
// year, and billing/payment history needs each period kept, not just the
// latest one.
const employerSubscriptionSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    planCode: { type: String, required: true },
    planName: { type: String, required: true },
    amount: { type: Number, required: true }, // paise, final payable (post-GST) amount actually charged
    currency: { type: String, default: 'INR' },
    billingPeriod: { type: String, enum: ['annual'], default: 'annual' },
    status: {
      type: String,
      enum: ['pending', 'active', 'expired', 'cancelled', 'payment_failed'],
      default: 'pending',
      index: true,
    },
    startsAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },
    paymentProvider: { type: String, default: 'razorpay' },
    razorpayOrderId: { type: String, default: null, index: true },
    razorpayPaymentId: { type: String, default: null, index: true },
    // HMAC signature from the completed payment — audit trail only, never
    // rendered back to any client (same treatment as Payment.razorpaySignature).
    razorpaySignature: { type: String, default: null, select: false },
    invoiceId: { type: String, default: null },
  },
  { timestamps: true }
)

employerSubscriptionSchema.index({ company: 1, status: 1 })
employerSubscriptionSchema.index({ company: 1, expiresAt: -1 })

applyIdTransform(employerSubscriptionSchema, { company: 'companyId' })

export default model('EmployerSubscription', employerSubscriptionSchema)
