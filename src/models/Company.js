import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const hiringContactSchema = new Schema(
  {
    name: String,
    role: String,
    email: String,
    phone: String,
  },
  { _id: true }
)

const companySchema = new Schema(
  {
    // Only `name` is required at signup — the rest is filled in later via the
    // Company Profile page, so a self-serve signup can create a company with
    // nothing but a name.
    name: { type: String, required: true },
    logo: { type: String, default: '' },
    industry: { type: String, default: '' },
    size: { type: String, default: '' },
    founded: { type: String, default: '' },
    website: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    about: { type: String, default: '' },
    hq: { type: String, default: '' },
    locations: { type: [String], default: [] },
    hiringContacts: { type: [hiringContactSchema], default: [] },
    gstin: { type: String, default: '' },
    pan: { type: String, default: '' },
    verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
    verificationMethod: { type: String, enum: ['gstin_pan', 'mca', 'video_call', 'site_visit', null], default: null },
    verificationNote: { type: String, default: '' },
    submittedOn: { type: Date, default: null },
    verifiedOn: { type: Date, default: null },
    verifiedBy: { type: String, default: null },
    blocked: { type: Boolean, default: false },
    blockedOn: { type: Date, default: null },
    blockedBy: { type: String, default: null },
    blockReason: { type: String, default: '' },
    openingsPurchased: { type: Number, default: 0 },
    totalBilled: { type: Number, default: 0 },
  },
  { timestamps: true }
)

applyIdTransform(companySchema)

const baseTransform = companySchema.options.toJSON.transform
companySchema.options.toJSON.transform = (doc, ret, options) => {
  ret = baseTransform(doc, ret, options)
  ret.hiringContacts = (ret.hiringContacts ?? []).map((contact) => {
    if (contact._id) {
      contact.id = contact._id.toString()
      delete contact._id
    }
    return contact
  })
  return ret
}

export default model('Company', companySchema)
