import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const paymentSchema = new Schema(
  {
    purpose: { type: String, enum: ['employee_subscription', 'employer_job_fee', 'employer_subscription', 'employer_cv_credit'], required: true },
    // Exactly one of these is set, based on `purpose`.
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    company: { type: Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', default: null, index: true },
    // Set only for purpose: 'employer_subscription' — the EmployerSubscription
    // period this payment is activating/renewing.
    employerSubscription: { type: Schema.Types.ObjectId, ref: 'EmployerSubscription', default: null, index: true },
    // Set only for purpose: 'employer_cv_credit' — which pack was bought and
    // how many credits it grants, fixed at order-creation time so a later
    // repricing of the pack never changes what an already-created order pays out.
    creditPlan: { type: Schema.Types.ObjectId, ref: 'CreditPlan', default: null },
    creditsGranted: { type: Number, default: null },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null, index: true, sparse: true },
    // HMAC signature Razorpay returns for the completed payment — kept for
    // audit/dispute trails, never rendered back to any client.
    razorpaySignature: { type: String, default: null, select: false },
    amount: { type: Number, required: true }, // rupees, after any coupon discount
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created', index: true },
    receipt: { type: String, required: true },
    // Coupon applied at order-creation time, if any. `originalAmount` is the
    // pre-discount fee, so `amount` alone stays what Razorpay actually charged.
    couponCode: { type: String, default: null },
    discountAmount: { type: Number, default: 0 },
    originalAmount: { type: Number, default: null },
    paidAt: { type: Date, default: null },
    // True when Razorpay wasn't configured and this order/payment was
    // simulated locally for dev/testing — never set for a real transaction.
    isMock: { type: Boolean, default: false },
  },
  { timestamps: true }
)

applyIdTransform(paymentSchema)

export default model('Payment', paymentSchema)
