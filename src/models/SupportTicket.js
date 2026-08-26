import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const supportTicketSchema = new Schema(
  {
    // Employer-raised tickets carry company + user; employee-raised tickets
    // carry employee instead — `source` says which side raised this so the
    // ops portal can tell the two apart in one shared queue.
    source: { type: String, enum: ['employer', 'employee'], required: true, default: 'employer' },
    company: { type: Schema.Types.ObjectId, ref: 'Company', index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', index: true },
    subject: { type: String, required: true },
    category: {
      type: String,
      enum: ['General', 'Billing', 'Candidate Quality', 'Technical Issue', 'Payment', 'Resume Verification', 'Mock Interview', 'Application Status'],
      default: 'General',
    },
    message: { type: String, required: true },
    status: { type: String, enum: ['Open', 'In Progress', 'Resolved'], default: 'Open', index: true },
    reply: { type: String, default: '' },
    respondedBy: { type: String, default: '' },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

applyIdTransform(supportTicketSchema)

export default model('SupportTicket', supportTicketSchema)
