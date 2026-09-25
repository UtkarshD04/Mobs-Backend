import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

export const ALLY_STATUSES = ['New', 'Reviewing', 'Shortlisted', 'Selected', 'Rejected']

const allyApplicationSchema = new Schema(
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
    status: { type: String, enum: ALLY_STATUSES, default: 'New' },
    notes: { type: String, trim: true, maxlength: 3000, default: '' },
    reviewedBy: { type: String, default: '' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
)

allyApplicationSchema.index({ createdAt: -1 })
allyApplicationSchema.index({ status: 1, createdAt: -1 })

applyIdTransform(allyApplicationSchema)

export default model('AllyApplication', allyApplicationSchema, 'campusmantriapplications')
