import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

export const ASSOCIATE_STATUSES = ['New', 'Contacted', 'Onboarded', 'Declined']
export const CITY_TYPES = ['Metro / large city', 'Small city / town']

const placementAssociateSchema = new Schema(
  {
    companyName: { type: String, required: true, trim: true, maxlength: 200 },
    contactName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 200 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    city: { type: String, required: true, trim: true, maxlength: 100 },
    cityType: { type: String, enum: CITY_TYPES, required: true },
    website: { type: String, trim: true, maxlength: 300, default: '' },
    about: { type: String, required: true, trim: true, maxlength: 3000 },
    // Issued once, the first time the associate is marked Onboarded (see staffAssociateController) — never changes after that.
    code: { type: String, unique: true, sparse: true },
    codeIssuedOn: { type: Date },
    status: { type: String, enum: ASSOCIATE_STATUSES, default: 'New' },
    notes: { type: String, trim: true, maxlength: 3000, default: '' },
    reviewedBy: { type: String, default: '' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
)

placementAssociateSchema.index({ createdAt: -1 })
placementAssociateSchema.index({ status: 1, createdAt: -1 })

applyIdTransform(placementAssociateSchema)

export default model('PlacementAssociate', placementAssociateSchema)
