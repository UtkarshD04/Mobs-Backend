import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const invoiceSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    description: { type: String, required: true },
    date: { type: Date, default: Date.now },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['due', 'paid'], default: 'due' },
    paymentMode: { type: String, enum: ['NEFT', 'RTGS', 'UPI', 'Cheque', 'Razorpay', null], default: null },
    reference: { type: String, default: '' },
  },
  { timestamps: true }
)

applyIdTransform(invoiceSchema)

export default model('Invoice', invoiceSchema)
