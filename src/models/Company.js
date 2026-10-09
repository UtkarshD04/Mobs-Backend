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

export const GST_STATUSES = ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'FAILED', 'UNDER_REVIEW']

// Result of the employer's own GSTIN check against a GST API provider (see
// utils/gstVerification.js). Only ever written by the server — never by the
// company-profile PUT — and kept separate from `verificationStatus` below,
// which stays the Mzobs staff decision behind the public "Verified" badge.
// Holds the minimum needed to show the result; no raw provider payload.
const gstVerificationSchema = new Schema(
  {
    status: { type: String, enum: GST_STATUSES, default: 'NOT_SUBMITTED' },
    gstin: { type: String, default: '' }, // last GSTIN submitted
    submittedLegalName: { type: String, default: '' },
    reason: { type: String, default: '' }, // machine code for FAILED/UNDER_REVIEW, e.g. NAME_MISMATCH
    legalName: { type: String, default: '' },
    tradeName: { type: String, default: '' },
    registrationStatus: { type: String, default: '' },
    registeredAddress: { type: String, default: '' },
    provider: { type: String, default: '' },
    providerReference: { type: String, default: '' },
    attempts: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    verifiedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: '' }, // staff name, when UNDER_REVIEW was resolved by hand
    reviewNote: { type: String, default: '' },
  },
  { _id: false }
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
    gstin: { type: String, default: '' }, // set from gstVerification once a GSTIN is VERIFIED
    pan: { type: String, default: '' },
    gstVerification: { type: gstVerificationSchema, default: () => ({}) },
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

// "Is this GSTIN already verified for another company?" lookups.
companySchema.index({ 'gstVerification.gstin': 1, 'gstVerification.status': 1 })

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
