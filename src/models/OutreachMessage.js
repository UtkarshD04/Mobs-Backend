import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// One row per email / SMS a recruiter sent to a candidate from the portal —
// the audit trail, and what the per-candidate daily cap counts (see
// utils/outreach.js). Failed sends are kept too, so support can see why a
// message never arrived.
const outreachMessageSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    candidate: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    sentBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    channel: { type: String, enum: ['email', 'sms'], required: true },
    subject: { type: String, default: '' },
    // The email text, or the SMS exactly as it was sent.
    body: { type: String, default: '' },
    status: { type: String, enum: ['sent', 'failed'], required: true },
    error: { type: String, default: '' },
    providerRef: { type: String, default: '' },
  },
  { timestamps: true }
)

outreachMessageSchema.index({ company: 1, candidate: 1, channel: 1, createdAt: -1 })

applyIdTransform(outreachMessageSchema, { company: 'companyId', candidate: 'candidateId', employee: 'employeeId', sentBy: 'sentById' })

export default model('OutreachMessage', outreachMessageSchema)
