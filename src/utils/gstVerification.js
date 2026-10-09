import { isValidGstin, normalizeGstin, compareCompanyNames } from './gstin.js'
import { GstProviderError } from './gstProviderError.js'

// Employer GSTIN verification. GST verification is mandatory: an employer
// account only becomes active once its company's gstVerification.status is
// VERIFIED (see middleware/requireGstVerified.js). Two entry points share
// the same lookup + decision rules:
//   • createSignupGstCheck — runs during signup, *before* any account exists.
//   • createGstVerifier    — POST /api/employer/company/verify-gst, the retry
//                             path for a pending company (website and app).
// DB access is injected so every rule is unit-tested without MongoDB — see
// gstVerification.test.js.
//
// Rules that keep this safe:
//   • Only a provider lookup can produce VERIFIED; a well-formed GSTIN alone never does.
//   • Provider errors, timeouts, exhausted credits, odd responses → never VERIFIED;
//     the company stays pending and can retry.
//   • A brand name that differs from the registered name is never auto-rejected:
//     it goes to UNDER_REVIEW for Mzobs staff.
//   • A company can only ever touch its own record (the caller passes req.company).
//   • One attempt at a time per company (atomic PENDING claim).

export const GST_MESSAGES = {
  VERIFIED: 'GSTIN verified.',
  FORBIDDEN: 'Only a company Admin can verify the GSTIN.',
  GSTIN_REQUIRED: 'GSTIN is required to register a company on Mzobs.',
  INVALID_GSTIN: 'Enter a valid 15-character GSTIN, e.g. 27AAPFU0939F1ZV.',
  INVALID_LEGAL_NAME: 'Enter the legal name exactly as it appears on the GST certificate.',
  INVALID_COMPANY_NAME: 'Enter your company name.',
  GST_NOT_CONFIGURED: 'GST verification is temporarily unavailable. Please try again later.',
  IN_PROGRESS: 'A verification is already in progress. Please wait a moment.',
  ALREADY_VERIFIED: 'Your GSTIN is already verified. Contact Mzobs support to change it.',
  UNDER_REVIEW: 'Your GSTIN is being reviewed by the Mzobs team. We’ll update the status once it’s done.',
  GSTIN_NOT_FOUND: 'No GST registration was found for this GSTIN.',
  INACTIVE_REGISTRATION: 'This GST registration is not active (cancelled or suspended).',
  NAME_MISMATCH: 'The legal name doesn’t match the GST record for this GSTIN.',
  PROFILE_NAME_DIFFERS: 'Your GST registration is valid, but the company name differs from the registered legal and trade name, so the Mzobs team will review it before your account is activated.',
  GSTIN_IN_USE: 'This GSTIN is already verified for another company on Mzobs, so the Mzobs team will review it.',
  GSTIN_ALREADY_REGISTERED: 'This GSTIN is already registered on Mzobs. Ask your company’s Mzobs admin to invite you, or contact Mzobs support.',
  STATUS_UNKNOWN: 'The GST registration status couldn’t be confirmed, so the Mzobs team will review it.',
  PROVIDER_RATE_LIMITED: 'The GST service is busy. Please try again in a few minutes.',
  PROVIDER_TIMEOUT: 'The GST service took too long to respond. Please try again.',
  PROVIDER_ERROR: 'We couldn’t reach the GST service. Please try again later.',
  REJECTED_BY_REVIEW: 'The Mzobs team couldn’t confirm this GSTIN for your company.',
  GST_VERIFICATION_REQUIRED: 'Your company’s GST verification must be completed before you can use this.',
}

const REGISTRATION_STATUSES = ['ACTIVE', 'CANCELLED', 'SUSPENDED', 'INACTIVE', 'UNKNOWN']
const MAX_TEXT = 300

const clip = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '')
const cleanName = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')
const nameOk = (v) => v.length >= 2 && v.length <= 200

// Checks the adapter's answer before any of it is trusted — the GSTIN must
// echo the request and the identity fields must be present.
export function validateLookupResult(result, gstin) {
  const ok =
    result &&
    typeof result === 'object' &&
    normalizeGstin(result.gstin) === gstin &&
    typeof result.legalName === 'string' &&
    result.legalName.trim() &&
    REGISTRATION_STATUSES.includes(result.registrationStatus)
  if (!ok) throw new GstProviderError('UNAVAILABLE', 'Provider returned an invalid or mismatched response')
  return {
    gstin,
    legalName: clip(result.legalName),
    tradeName: clip(result.tradeName),
    registrationStatus: result.registrationStatus,
    address: clip(result.address),
    providerReference: clip(result.providerReference),
  }
}

// The identity decision for a successful lookup. `companyName` is the
// company's own (profile) name; `submittedLegalName` is what the employer typed.
export function evaluateLookup({ lookup, submittedLegalName, companyName, verifiedElsewhere }) {
  if (lookup.registrationStatus === 'UNKNOWN') return { status: 'UNDER_REVIEW', reason: 'STATUS_UNKNOWN' }
  if (lookup.registrationStatus !== 'ACTIVE') return { status: 'FAILED', reason: 'INACTIVE_REGISTRATION' }

  // The employer must know the registered legal name (case, punctuation and
  // "Pvt"/"Private"-style differences are ignored).
  if (compareCompanyNames(lookup.legalName, submittedLegalName) !== 'exact') return { status: 'FAILED', reason: 'NAME_MISMATCH' }

  if (verifiedElsewhere) return { status: 'UNDER_REVIEW', reason: 'GSTIN_IN_USE' }

  // The company name must be the legal or trade name. A different brand name
  // is common and legitimate, so it is never rejected — a human reviews it.
  const profileMatch = [lookup.legalName, lookup.tradeName].some((n) => n && compareCompanyNames(n, companyName) === 'exact')
  if (!profileMatch) return { status: 'UNDER_REVIEW', reason: 'PROFILE_NAME_DIFFERS' }

  return { status: 'VERIFIED', reason: '' }
}

const PROVIDER_FAILURES = {
  NOT_FOUND: { reason: 'GSTIN_NOT_FOUND', httpStatus: 200 },
  RATE_LIMITED: { reason: 'PROVIDER_RATE_LIMITED', httpStatus: 429 },
  TIMEOUT: { reason: 'PROVIDER_TIMEOUT', httpStatus: 504 },
  AUTH: { reason: 'PROVIDER_ERROR', httpStatus: 502 }, // bad key, no credits, account off
  UNAVAILABLE: { reason: 'PROVIDER_ERROR', httpStatus: 502 },
}

// Outcomes that are the employer's to fix (wrong GSTIN / name, inactive
// registration). At signup these refuse the registration outright, so no
// account is created for data that can never verify.
export const DEFINITIVE_FAILURES = ['GSTIN_NOT_FOUND', 'INACTIVE_REGISTRATION', 'NAME_MISMATCH']

function lookupWithTimeout(provider, gstin, timeoutMs) {
  const controller = new AbortController()
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new GstProviderError('TIMEOUT', `No provider response within ${timeoutMs}ms`))
    }, timeoutMs)
  })
  return Promise.race([provider.lookup(gstin, { signal: controller.signal }), timeout]).finally(() => clearTimeout(timer))
}

// One provider round trip → { status, reason, httpStatus, details }. Never
// throws: every provider/network problem becomes FAILED with a reason.
async function lookupAndDecide({ provider, gstin, submittedLegalName, companyName, isVerifiedElsewhere, timeoutMs, logger, logContext }) {
  try {
    const lookup = validateLookupResult(await lookupWithTimeout(provider, gstin, timeoutMs), gstin)
    const { status, reason } = evaluateLookup({ lookup, submittedLegalName, companyName, verifiedElsewhere: await isVerifiedElsewhere() })
    // Identity details are kept only when the GSTIN is (or may be) this
    // company's; a failed match keeps just the registration status.
    const details =
      status === 'FAILED'
        ? { registrationStatus: lookup.registrationStatus, providerReference: lookup.providerReference }
        : {
            legalName: lookup.legalName,
            tradeName: lookup.tradeName,
            registrationStatus: lookup.registrationStatus,
            registeredAddress: lookup.address,
            providerReference: lookup.providerReference,
          }
    return { status, reason, httpStatus: 200, details }
  } catch (err) {
    const code = err instanceof GstProviderError ? err.code : 'UNAVAILABLE'
    // Adapter messages are our own text (never credentials or payloads).
    logger?.warn({ ...logContext, providerCode: code, provider: provider.name, detail: err instanceof GstProviderError ? err.message : 'unexpected error' }, 'GST provider lookup failed')
    return { status: 'FAILED', ...PROVIDER_FAILURES[code], details: {} }
  }
}

// Validates the GST part of a signup body ({ gstin, gstLegalName }) — both
// required — before anything else runs.
// → { gst: { gstin, legalName } } | { error: { code, message } }
export function parseSignupGst(body, { required = true } = {}) {
  const gstin = normalizeGstin(body?.gstin)
  // Optional mode: a blank GSTIN just skips verification; a filled one is still validated.
  if (!gstin && !required) return { gst: null }
  if (!gstin) return { error: { code: 'GSTIN_REQUIRED', message: GST_MESSAGES.GSTIN_REQUIRED } }
  if (!isValidGstin(gstin)) return { error: { code: 'INVALID_GSTIN', message: GST_MESSAGES.INVALID_GSTIN } }
  const legalName = cleanName(body.gstLegalName)
  if (!nameOk(legalName)) return { error: { code: 'INVALID_LEGAL_NAME', message: GST_MESSAGES.INVALID_LEGAL_NAME } }
  return { gst: { gstin, legalName } }
}

// Signup-time check, run after the signup's own validation and before any
// account is created. Returns either
//   { reject: { httpStatus, code, message } }     — create nothing
//   { record, code, message, audit }              — create the company with
//                                                   `record` as its gstVerification
// `isGstinClaimed(gstin)` → true when another company already holds this
// GSTIN (verified or under review) — signing up again would duplicate it.
export function createSignupGstCheck({ getProvider, isGstinClaimed, timeoutMs = 10000, now = () => new Date(), logger = null }) {
  return async function checkSignupGst({ gstin, legalName, companyName }) {
    if (await isGstinClaimed(gstin)) {
      return { reject: { httpStatus: 409, code: 'GSTIN_ALREADY_REGISTERED', message: GST_MESSAGES.GSTIN_ALREADY_REGISTERED } }
    }

    const startedAt = now()
    const base = { gstin, submittedLegalName: legalName, attempts: 1, lastAttemptAt: startedAt }
    const provider = getProvider()
    if (!provider) {
      // Can't verify right now — the account is created pending, never active.
      return {
        record: { ...base, status: 'NOT_SUBMITTED', reason: 'GST_NOT_CONFIGURED' },
        code: 'GST_NOT_CONFIGURED',
        message: GST_MESSAGES.GST_NOT_CONFIGURED,
        audit: { gstin, outcome: 'NOT_SUBMITTED', reason: 'GST_NOT_CONFIGURED' },
      }
    }

    const d = await lookupAndDecide({ provider, gstin, submittedLegalName: legalName, companyName, isVerifiedElsewhere: async () => false, timeoutMs, logger, logContext: { at: 'signup' } })
    const finishedAt = now()
    const audit = { gstin, outcome: d.status, reason: d.reason, provider: provider.name, providerReference: d.details.providerReference ?? '', durationMs: finishedAt.getTime() - startedAt.getTime() }

    if (d.status === 'FAILED' && DEFINITIVE_FAILURES.includes(d.reason)) {
      return { reject: { httpStatus: 422, code: d.reason, message: GST_MESSAGES[d.reason] }, audit }
    }

    const code = d.status === 'VERIFIED' ? 'VERIFIED' : d.reason
    return {
      record: { ...base, status: d.status, reason: d.reason, provider: provider.name, ...d.details, verifiedAt: d.status === 'VERIFIED' ? finishedAt : null },
      code,
      message: GST_MESSAGES[code],
      audit,
    }
  }
}

const refusal = (httpStatus, code, gstVerification = null) => ({ httpStatus, code, message: GST_MESSAGES[code], gstVerification })

// repo: {
//   claim(companyId, { gstin, submittedLegalName, companyName, now, staleBefore }) → gstVerification | null
//   finish(companyId, gstin, fields) → gstVerification
//   get(companyId) → gstVerification
//   isVerifiedElsewhere(gstin, companyId) → boolean
//   logAttempt(entry) → void
// }
// `companyName` (optional) renames the company as part of the claim — only
// possible while it has never been verified, e.g. a pay-first guest account
// still named "New Employer Account".
export function createGstVerifier({ repo, getProvider, timeoutMs = 10000, now = () => new Date(), logger = null }) {
  // A PENDING claim older than this is treated as abandoned (crashed worker)
  // and may be taken over by a new attempt.
  const staleMs = timeoutMs + 30_000

  return async function verifyCompanyGst({ company, user, gstin: rawGstin, legalName: rawLegalName, companyName: rawCompanyName }) {
    const companyId = company._id
    const audit = (entry) =>
      Promise.resolve(repo.logAttempt({ company: companyId, user: user?._id ?? null, ...entry })).catch((err) =>
        logger?.error({ err: err.message, companyId: String(companyId) }, 'GST audit log write failed')
      )

    if (user?.role !== 'Admin') {
      await audit({ gstin: '', outcome: 'REFUSED', reason: 'FORBIDDEN' })
      return refusal(403, 'FORBIDDEN')
    }

    const gstin = normalizeGstin(rawGstin)
    if (!isValidGstin(gstin)) return refusal(400, 'INVALID_GSTIN')
    const submittedLegalName = cleanName(rawLegalName)
    if (!nameOk(submittedLegalName)) return refusal(400, 'INVALID_LEGAL_NAME')
    const newName = rawCompanyName === undefined ? null : cleanName(rawCompanyName)
    if (newName !== null && !nameOk(newName)) return refusal(400, 'INVALID_COMPANY_NAME')
    const companyName = newName ?? company.name

    const provider = getProvider()
    if (!provider) {
      await audit({ gstin, outcome: 'REFUSED', reason: 'GST_NOT_CONFIGURED' })
      return refusal(503, 'GST_NOT_CONFIGURED', await repo.get(companyId))
    }

    const startedAt = now()
    const claimed = await repo.claim(companyId, { gstin, submittedLegalName, companyName: newName, now: startedAt, staleBefore: new Date(startedAt.getTime() - staleMs) })
    if (!claimed) {
      const current = await repo.get(companyId)
      const code = current?.status === 'VERIFIED' ? 'ALREADY_VERIFIED' : current?.status === 'UNDER_REVIEW' ? 'UNDER_REVIEW' : 'IN_PROGRESS'
      await audit({ gstin, outcome: 'REFUSED', reason: code })
      return refusal(409, code, current)
    }

    const d = await lookupAndDecide({
      provider,
      gstin,
      submittedLegalName,
      companyName,
      isVerifiedElsewhere: () => repo.isVerifiedElsewhere(gstin, companyId),
      timeoutMs,
      logger,
      logContext: { companyId: String(companyId) },
    })

    const finishedAt = now()
    const gstVerification = await repo.finish(companyId, gstin, {
      status: d.status,
      reason: d.reason,
      provider: provider.name,
      ...d.details,
      verifiedAt: d.status === 'VERIFIED' ? finishedAt : null,
    })
    await audit({
      gstin,
      outcome: d.status,
      reason: d.reason,
      provider: provider.name,
      providerReference: d.details.providerReference ?? '',
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    })

    const code = d.status === 'VERIFIED' ? 'VERIFIED' : d.reason
    return { httpStatus: d.httpStatus, code, message: GST_MESSAGES[code], gstVerification }
  }
}
