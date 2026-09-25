import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

export const DOOT_STATUSES = ['New', 'Reviewing', 'Shortlisted', 'Selected', 'Rejected']

const dootApplicationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    phone: { type: String, trim: true, maxlength: 20, default: '' },
    college: { type: String, required: true, trim: true, maxlength: 200 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    course: { type: String, required: true, trim: true, maxlength: 120 },
    experience: { type: String, required: true, trim: true, maxlength: 3000 },
    involvement: { type: String, trim: true, maxlength: 3000, default: '' },
    why: { type: String, required: true, trim: true, maxlength: 3000 },
    status: { type: String, enum: DOOT_STATUSES, default: 'New' },
    notes: { type: String, trim: true, maxlength: 3000, default: '' },
    reviewedBy: { type: String, default: '' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
)

dootApplicationSchema.index({ createdAt: -1 })
dootApplicationSchema.index({ status: 1, createdAt: -1 })

applyIdTransform(dootApplicationSchema)

export default model('DootApplication', dootApplicationSchema, 'campusmantriapplications')
