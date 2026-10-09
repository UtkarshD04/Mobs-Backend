import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// Audit trail: one row per GSTIN verification attempt (including ones refused
// before reaching the provider, e.g. not configured or already in progress)
// and per staff review decision. Never holds credentials or provider payloads.
const gstVerificationAttemptSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', default: null, index: true }, // null for a signup refused before any company existed
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    staffName: { type: String, default: '' },
    gstin: { type: String, default: '' },
    outcome: { type: String, required: true }, // resulting status, or REFUSED
    reason: { type: String, default: '' },
    provider: { type: String, default: '' },
    providerReference: { type: String, default: '' },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

applyIdTransform(gstVerificationAttemptSchema)

export default model('GstVerificationAttempt', gstVerificationAttemptSchema)
