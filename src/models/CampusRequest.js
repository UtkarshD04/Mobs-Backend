import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

export const CAMPUS_REQUEST_STATUSES = ['pending', 'under_review', 'verified', 'rejected']
export const INSTITUTION_TYPES = ['University', 'Engineering College', 'Degree College', 'Management Institute', 'Polytechnic', 'Other']

// "Add Your Campus" partnership requests from colleges/universities (landing site
// /add-your-campus/apply), reviewed in the Operations portal.
const campusRequestSchema = new Schema(
  {
    campusName: { type: String, required: true, trim: true, maxlength: 200 },
    institutionType: { type: String, enum: INSTITUTION_TYPES, required: true },
    website: { type: String, trim: true, maxlength: 300, default: '' },
    studentStrength: { type: Number, min: 0 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    state: { type: String, required: true, trim: true, maxlength: 100 },
    contactPerson: { type: String, required: true, trim: true, maxlength: 120 },
    officialEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    message: { type: String, trim: true, maxlength: 3000, default: '' },
    status: { type: String, enum: CAMPUS_REQUEST_STATUSES, default: 'pending' },
    notes: { type: String, trim: true, maxlength: 3000, default: '' },
    reviewedBy: { type: String, default: '' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
)

campusRequestSchema.index({ createdAt: -1 })
campusRequestSchema.index({ status: 1, createdAt: -1 })

applyIdTransform(campusRequestSchema)

export default model('CampusRequest', campusRequestSchema)
