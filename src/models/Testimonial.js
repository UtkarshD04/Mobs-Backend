import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// A candidate's own words about getting hired, shown on the public marketing
// site. A row only goes public when BOTH the candidate has consented to
// public use (`publicConsent`) AND staff have approved it (`status`).
// `displayName` / `photoUrl` are snapshots of what the candidate agreed to
// show, so later profile edits never change what is published without a new
// approval.
const testimonialSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    photoUrl: { type: String, default: '', trim: true },
    feedback: { type: String, required: true, trim: true, maxlength: 1200 },
    publicConsent: { type: Boolean, default: false },
    consentAt: { type: Date, default: null },
    // Set by staff only after confirming a real placement through Mzobs.
    placementVerified: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'hidden'], default: 'pending', index: true },
    featured: { type: Boolean, default: false },
    approvedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

applyIdTransform(testimonialSchema)

export default model('Testimonial', testimonialSchema)
