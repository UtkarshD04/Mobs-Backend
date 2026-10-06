import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

export const PLAN_ENQUIRY_STATUSES = ['New', 'Contacted', 'Closed']
export const PLAN_ENQUIRY_SOURCES = ['website', 'app']

// A "Customize plan" request from an employer — someone who doesn't fit the fixed ₹999 / ₹1499 / ₹2199 tiers.
// The Operations team calls them back from the Plan enquiries page.
const planEnquirySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    companyName: { type: String, required: true, trim: true, maxlength: 200 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    source: { type: String, enum: PLAN_ENQUIRY_SOURCES, default: 'website' },
    status: { type: String, enum: PLAN_ENQUIRY_STATUSES, default: 'New' },
    notes: { type: String, trim: true, maxlength: 3000, default: '' },
    handledBy: { type: String, default: '' },
    handledAt: { type: Date },
  },
  { timestamps: true }
)

planEnquirySchema.index({ createdAt: -1 })
planEnquirySchema.index({ status: 1, createdAt: -1 })

applyIdTransform(planEnquirySchema)

export default model('PlanEnquiry', planEnquirySchema)
