import { asyncHandler } from '../utils/asyncHandler.js'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import { createGstVerifier, createSignupGstCheck } from '../utils/gstVerification.js'
import { getGstProvider } from '../utils/gstProviders.js'
import Company from '../models/Company.js'
import GstVerificationAttempt from '../models/GstVerificationAttempt.js'

// GST fields are deliberately absent: only the verify-gst flow below writes them.
const EDITABLE_FIELDS = ['name', 'industry', 'size', 'founded', 'website', 'linkedin', 'hq', 'about']

export const getCompany = asyncHandler(async (req, res) => {
  res.json(req.company)
})

export const updateCompany = asyncHandler(async (req, res) => {
  const updates = {}
  for (const field of EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field]
  }
  // The company name is part of its verified GST identity — once verified
  // (or awaiting review) it can't be swapped for another name.
  const gstStatus = req.company.gstVerification?.status
  if (updates.name !== undefined && updates.name !== req.company.name && ['VERIFIED', 'UNDER_REVIEW', 'PENDING'].includes(gstStatus)) {
    return res.status(409).json({ code: 'NAME_LOCKED', message: 'Your company name is tied to its verified GST registration. Contact Mzobs support to change it.' })
  }

  const company = await Company.findByIdAndUpdate(req.company._id, updates, {
    new: true,
    runValidators: true,
  })

  res.json(company)
})

const RESULT_FIELDS = ['legalName', 'tradeName', 'registrationStatus', 'registeredAddress', 'providerReference']
const plain = (doc) => (doc ? (doc.toJSON?.().gstVerification ?? null) : null)

// Mongo side of utils/gstVerification.js. Every write is scoped to the
// caller's own company id and guarded on the current status, so overlapping
// requests can't both run or overwrite each other's result.
export const mongoGstRepo = {
  async claim(companyId, { gstin, submittedLegalName, companyName, now, staleBefore }) {
    const set = { 'gstVerification.status': 'PENDING', 'gstVerification.gstin': gstin, 'gstVerification.submittedLegalName': submittedLegalName, 'gstVerification.reason': '', 'gstVerification.lastAttemptAt': now, 'gstVerification.verifiedAt': null }
    for (const f of RESULT_FIELDS) set[`gstVerification.${f}`] = ''
    // Only reachable for a never-verified company (see the status filter below).
    if (companyName) set.name = companyName
    const doc = await Company.findOneAndUpdate(
      {
        _id: companyId,
        $or: [
          { 'gstVerification.status': { $nin: ['PENDING', 'VERIFIED', 'UNDER_REVIEW'] } },
          { 'gstVerification.status': 'PENDING', 'gstVerification.lastAttemptAt': { $lt: staleBefore } },
        ],
      },
      { $set: set, $inc: { 'gstVerification.attempts': 1 } },
      { new: true }
    )
    return plain(doc)
  },

  async finish(companyId, gstin, fields) {
    const set = {}
    for (const [k, v] of Object.entries(fields)) set[`gstVerification.${k}`] = v
    if (fields.status === 'VERIFIED') set.gstin = gstin
    const doc = await Company.findOneAndUpdate({ _id: companyId, 'gstVerification.status': 'PENDING', 'gstVerification.gstin': gstin }, { $set: set }, { new: true })
    return plain(doc) ?? this.get(companyId)
  },

  async get(companyId) {
    return plain(await Company.findById(companyId).select('gstVerification'))
  },

  async isVerifiedElsewhere(gstin, companyId) {
    return Boolean(await Company.exists({ _id: { $ne: companyId }, 'gstVerification.gstin': gstin, 'gstVerification.status': 'VERIFIED' }))
  },

  logAttempt(entry) {
    return GstVerificationAttempt.create(entry)
  },
}

// Audit-trail writer for callers outside the verifier (signup). Never throws.
export function logGstAttempt(entry) {
  return GstVerificationAttempt.create(entry).catch((err) => logger.error({ err: err.message }, 'GST audit log write failed'))
}

// Signup-time GST check (authController.js signup/googleSignup). A GSTIN
// another company already holds — verified, under review or mid-check —
// refuses the signup instead of creating a duplicate company.
export const checkSignupGst = createSignupGstCheck({
  getProvider: () => getGstProvider(),
  isGstinClaimed: async (gstin) =>
    Boolean(await Company.exists({ $or: [{ gstin }, { 'gstVerification.gstin': gstin, 'gstVerification.status': { $in: ['VERIFIED', 'UNDER_REVIEW', 'PENDING'] } }] })),
  timeoutMs: env.gstVerification.timeoutMs,
  logger,
})

export const verifyCompanyGst = createGstVerifier({
  repo: mongoGstRepo,
  getProvider: () => getGstProvider(),
  timeoutMs: env.gstVerification.timeoutMs,
  logger,
})

// POST /api/employer/company/verify-gst  { gstin, legalName, companyName? }
// The retry path for a pending company (also the first check for pay-first
// guest and staff-onboarded accounts, which sign up without a GSTIN).
// Always answers { code, message, gstVerification } — see GST_MESSAGES for codes.
export const verifyGst = asyncHandler(async (req, res) => {
  const { httpStatus, code, message, gstVerification } = await verifyCompanyGst({
    company: req.company,
    user: req.user,
    gstin: req.body?.gstin,
    legalName: req.body?.legalName,
    companyName: req.body?.companyName,
  })
  res.status(httpStatus).json({ code, message, gstVerification })
})
