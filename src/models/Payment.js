import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const paymentSchema = new Schema(
  {
    purpose: { type: String, enum: ['employee_subscription', 'employer_job_fee'], required: true },
    // Exactly one of these is set, based on `purpose`.
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    company: { type: Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', default: null, index: true },
    razorpayOrderId: { type: String, required: true, unique: true },
    razorpayPaymentId: { type: String, default: null, index: true, sparse: true },
    // HMAC signature Razorpay returns for the completed payment — kept for
    // audit/dispute trails, never rendered back to any client.
    razorpaySignature: { type: String, default: null, select: false },
    amount: { type: Number, required: true }, // rupees
    currency: { type: String, default: 'INR' },
    status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created', index: true },
    receipt: { type: String, required: true },
    paidAt: { type: Date, default: null },
    // True when Razorpay wasn't configured and this order/payment was
    // simulated locally for dev/testing — never set for a real transaction.
    isMock: { type: Boolean, default: false },
  },
  { timestamps: true }
)

applyIdTransform(paymentSchema)

export default model('Payment', paymentSchema)
