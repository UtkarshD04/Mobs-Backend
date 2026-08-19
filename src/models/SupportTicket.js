import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const supportTicketSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    subject: { type: String, required: true },
    category: { type: String, enum: ['General', 'Billing', 'Candidate Quality', 'Technical Issue'], default: 'General' },
    message: { type: String, required: true },
  },
  { timestamps: true }
)

applyIdTransform(supportTicketSchema)

export default model('SupportTicket', supportTicketSchema)
