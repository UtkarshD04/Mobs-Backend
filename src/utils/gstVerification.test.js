process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'unit-test-secret'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
const { isValidGstin, normalizeGstin, compareCompanyNames } = await import('./gstin.js')
const { GstProviderError, getGstProvider } = await import('./gstProviders.js')
const { createGstVerifier, createSignupGstCheck, evaluateLookup, parseSignupGst } = await import('./gstVerification.js')
const { requireAuth } = await import('../middleware/auth.js')
const { classifyEmployerPath, requireGstVerified, employerAccessGate } = await import('../middleware/requireGstVerified.js')

// Published sample GSTINs with valid check digits. Not tied to any real
// lookup here — every provider below is a local fake.
const GSTIN = '27AAPFU0939F1ZV'
const OTHER_GSTIN = '29AABCU9603R1ZJ'

describe('GSTIN format', () => {
  test('accepts well-formed GSTINs with a correct check digit, case/space-insensitive', () => {
    assert.ok(isValidGstin(GSTIN))
    assert.ok(isValidGstin(OTHER_GSTIN))
    assert.ok(isValidGstin(' 27aapfu0939f1zv '))
    assert.equal(normalizeGstin(' 27aapfu0939f1zv '), GSTIN)
  })

  test('rejects wrong length, wrong shape and a bad check digit', () => {
    for (const bad of ['', '27AAPFU0939F1Z', '27AAPFU0939F1ZVX', '2XAAPFU0939F1ZV', '27AAPFU0939F1AV', '27AAPFU0939F0ZV', '27AAPFU0939F1ZA', null, 123]) {
      assert.equal(isValidGstin(bad), false, String(bad))
    }
  })
})

describe('company name comparison', () => {
  test('ignores case, punctuation, M/s and Pvt/Ltd abbreviations', () => {
    assert.equal(compareCompanyNames('M/s. Acme Pvt. Ltd.', 'ACME PRIVATE LIMITED'), 'exact')
    assert.equal(compareCompanyNames('Acme & Sons', 'acme and sons'), 'exact')
  })
  test('partial and unrelated names', () => {
    assert.equal(compareCompanyNames('Acme Technologies Private Limited', 'Acme'), 'partial')
    assert.equal(compareCompanyNames('Acme Private Limited', 'Globex Private Limited'), 'none')
  })
})

describe('evaluateLookup', () => {
  const active = { legalName: 'Acme Private Limited', tradeName: 'Acme', registrationStatus: 'ACTIVE' }
  const base = { submittedLegalName: 'Acme Pvt Ltd', companyName: 'Acme', verifiedElsewhere: false }

  test('profile name equal to the legal or trade name verifies', () => {
    assert.deepEqual(evaluateLookup({ ...base, lookup: active }), { status: 'VERIFIED', reason: '' })
  })
  test('profile name that differs from both goes to review, never straight to verified', () => {
    assert.equal(evaluateLookup({ ...base, companyName: 'Some Other Brand', lookup: active }).status, 'UNDER_REVIEW')
  })
  test('unknown registration status goes to review', () => {
    assert.equal(evaluateLookup({ ...base, lookup: { ...active, registrationStatus: 'UNKNOWN' } }).reason, 'STATUS_UNKNOWN')
  })
})

// ─── service ────────────────────────────────────────────────────────────────

function memoryRepo(initial = { status: 'NOT_SUBMITTED' }, { verifiedElsewhere = false } = {}) {
  const repo = {
    record: { ...initial },
    audit: [],
    async claim(_id, { gstin, submittedLegalName, now, staleBefore }) {
      const s = repo.record.status
      const stale = s === 'PENDING' && repo.record.lastAttemptAt < staleBefore
      if (['PENDING', 'VERIFIED', 'UNDER_REVIEW'].includes(s) && !stale) return null
      repo.record = { status: 'PENDING', gstin, submittedLegalName, lastAttemptAt: now, attempts: (repo.record.attempts ?? 0) + 1 }
      return { ...repo.record }
    },
    async finish(_id, gstin, fields) {
      if (repo.record.status === 'PENDING' && repo.record.gstin === gstin) repo.record = { ...repo.record, ...fields }
      return { ...repo.record }
    },
    async get() {
      return { ...repo.record }
    },
    async isVerifiedElsewhere() {
      return verifiedElsewhere
    },
    async logAttempt(entry) {
      repo.audit.push(entry)
    },
  }
  return repo
}

const fakeProvider = (lookup) => ({ name: 'fake', calls: 0, async lookup(gstin, opts) { this.calls++; return lookup(gstin, opts) } })
const activeRecord = (gstin) => ({ gstin, legalName: 'Acme Private Limited', tradeName: '', registrationStatus: 'ACTIVE', address: '1 Main Rd, Pune', providerReference: 'ref-1' })

const admin = { _id: 'u1', role: 'Admin' }
const company = { _id: 'c1', name: 'Acme Pvt Ltd' }
const request = { company, user: admin, gstin: GSTIN, legalName: 'ACME PRIVATE LIMITED' }

function setup(provider, repoOpts) {
  const repo = memoryRepo(...(repoOpts ?? []))
  const verify = createGstVerifier({ repo, getProvider: () => provider, timeoutMs: 50 })
  return { repo, verify }
}

describe('verifyCompanyGst', () => {
  test('valid, active GSTIN whose names match → VERIFIED with minimal details stored', async () => {
    const { repo, verify } = setup(fakeProvider(activeRecord))
    const res = await verify(request)
    assert.equal(res.httpStatus, 200)
    assert.equal(res.code, 'VERIFIED')
    assert.equal(res.gstVerification.status, 'VERIFIED')
    assert.equal(res.gstVerification.legalName, 'Acme Private Limited')
    assert.equal(res.gstVerification.registeredAddress, '1 Main Rd, Pune')
    assert.ok(res.gstVerification.verifiedAt instanceof Date)
    assert.equal(repo.audit.at(-1).outcome, 'VERIFIED')
  })

  test('invalid GSTIN is rejected before any provider call and nothing is recorded', async () => {
    const provider = fakeProvider(activeRecord)
    const { repo, verify } = setup(provider)
    const res = await verify({ ...request, gstin: '27AAPFU0939F1ZA' })
    assert.equal(res.httpStatus, 400)
    assert.equal(res.code, 'INVALID_GSTIN')
    assert.equal(provider.calls, 0)
    assert.equal(repo.record.status, 'NOT_SUBMITTED')
  })

  test('cancelled/suspended registration → FAILED inactive, no identity details kept', async () => {
    const { verify } = setup(fakeProvider((g) => ({ ...activeRecord(g), registrationStatus: 'CANCELLED' })))
    const res = await verify(request)
    assert.equal(res.code, 'INACTIVE_REGISTRATION')
    assert.equal(res.gstVerification.status, 'FAILED')
    assert.equal(res.gstVerification.legalName, undefined)
  })

  test('legal name that does not match the GST record → FAILED name mismatch', async () => {
    const { verify } = setup(fakeProvider(activeRecord))
    const res = await verify({ ...request, legalName: 'Globex Private Limited' })
    assert.equal(res.code, 'NAME_MISMATCH')
    assert.equal(res.gstVerification.status, 'FAILED')
  })

  test('GSTIN already verified by another company → UNDER_REVIEW, not VERIFIED', async () => {
    const { verify } = setup(fakeProvider(activeRecord), [undefined, { verifiedElsewhere: true }])
    const res = await verify(request)
    assert.equal(res.gstVerification.status, 'UNDER_REVIEW')
    assert.equal(res.code, 'GSTIN_IN_USE')
  })

  test('provider timeout → FAILED (504), aborts the provider request', async () => {
    let aborted = false
    const provider = fakeProvider((_g, { signal }) => new Promise(() => signal.addEventListener('abort', () => (aborted = true))))
    const { verify } = setup(provider)
    const res = await verify(request)
    assert.equal(res.httpStatus, 504)
    assert.equal(res.code, 'PROVIDER_TIMEOUT')
    assert.equal(res.gstVerification.status, 'FAILED')
    assert.ok(aborted)
  })

  test('provider rate limit, errors and malformed responses are FAILED, never VERIFIED', async () => {
    const cases = [
      [() => Promise.reject(new GstProviderError('RATE_LIMITED')), 429, 'PROVIDER_RATE_LIMITED'],
      [() => Promise.reject(new Error('socket hang up')), 502, 'PROVIDER_ERROR'],
      [() => Promise.reject(new GstProviderError('NOT_FOUND')), 200, 'GSTIN_NOT_FOUND'],
      [() => ({ ...activeRecord(OTHER_GSTIN) }), 502, 'PROVIDER_ERROR'], // echoes a different GSTIN
      [() => ({ gstin: GSTIN, registrationStatus: 'ACTIVE' }), 502, 'PROVIDER_ERROR'], // no legal name
    ]
    for (const [lookup, httpStatus, code] of cases) {
      const { verify } = setup(fakeProvider(lookup))
      const res = await verify(request)
      assert.equal(res.httpStatus, httpStatus, code)
      assert.equal(res.code, code)
      assert.equal(res.gstVerification.status, 'FAILED')
    }
  })

  test('no provider configured → 503, record untouched, attempt audited', async () => {
    const { repo, verify } = setup(null)
    const res = await verify(request)
    assert.equal(res.httpStatus, 503)
    assert.equal(res.code, 'GST_NOT_CONFIGURED')
    assert.equal(repo.record.status, 'NOT_SUBMITTED')
    assert.equal(repo.audit.at(-1).reason, 'GST_NOT_CONFIGURED')
  })

  test('non-Admin team member is refused (403) and nothing changes', async () => {
    const provider = fakeProvider(activeRecord)
    const { repo, verify } = setup(provider)
    const res = await verify({ ...request, user: { _id: 'u2', role: 'Recruiter' } })
    assert.equal(res.httpStatus, 403)
    assert.equal(provider.calls, 0)
    assert.equal(repo.record.status, 'NOT_SUBMITTED')
  })

  test('a second request while one is in flight is refused, and a failed attempt can be retried', async () => {
    let release
    const provider = fakeProvider((g) => new Promise((resolve) => (release = () => resolve(activeRecord(g)))))
    const repo = memoryRepo()
    const verify = createGstVerifier({ repo, getProvider: () => provider, timeoutMs: 1000 })
    const first = verify({ ...request, legalName: 'Wrong Name Ltd' })
    await new Promise((r) => setImmediate(r))
    const second = await verify(request)
    assert.equal(second.httpStatus, 409)
    assert.equal(second.code, 'IN_PROGRESS')
    release()
    assert.equal((await first).gstVerification.status, 'FAILED')

    const retry = verify(request)
    await new Promise((r) => setImmediate(r))
    release()
    const retried = await retry
    assert.equal(retried.gstVerification.status, 'VERIFIED')
    assert.equal(repo.record.attempts, 2, 'same record updated, not duplicated')
  })

  test('an already VERIFIED GSTIN cannot be overwritten by a new submission', async () => {
    const { verify } = setup(fakeProvider(activeRecord), [{ status: 'VERIFIED', gstin: GSTIN }])
    const res = await verify({ ...request, gstin: OTHER_GSTIN })
    assert.equal(res.httpStatus, 409)
    assert.equal(res.code, 'ALREADY_VERIFIED')
  })
})

describe('mandatory GSTIN at signup — input', () => {
  test('GSTIN and legal name are both required; GSTIN is normalised and checksum-validated', () => {
    assert.equal(parseSignupGst({}).error.code, 'GSTIN_REQUIRED')
    assert.equal(parseSignupGst({ gstin: '  ', gstLegalName: 'Acme' }).error.code, 'GSTIN_REQUIRED')
    assert.equal(parseSignupGst({ gstin: '27AAPFU0939F1ZA', gstLegalName: 'Acme' }).error.code, 'INVALID_GSTIN')
    assert.equal(parseSignupGst({ gstin: GSTIN }).error.code, 'INVALID_LEGAL_NAME')
    assert.deepEqual(parseSignupGst({ gstin: ' 27aapfu0939f1zv', gstLegalName: ' Acme  Pvt Ltd ' }), { gst: { gstin: GSTIN, legalName: 'Acme Pvt Ltd' } })
  })
})

describe('mandatory GSTIN at signup — provider check', () => {
  const signupInput = { gstin: GSTIN, legalName: 'Acme Private Limited', companyName: 'Acme Pvt Ltd' }
  const check = (provider, { claimed = false, input = signupInput } = {}) =>
    createSignupGstCheck({ getProvider: () => provider, isGstinClaimed: async () => claimed, timeoutMs: 50 })(input)

  test('active GSTIN, matching legal and company name → account created VERIFIED (active)', async () => {
    const r = await check(fakeProvider(activeRecord))
    assert.equal(r.reject, undefined)
    assert.equal(r.record.status, 'VERIFIED')
    assert.equal(r.record.gstin, GSTIN)
    assert.ok(r.record.verifiedAt instanceof Date)
    assert.equal(r.audit.outcome, 'VERIFIED')
  })

  test('brand name differing from legal and trade name → created but pending manual review, never rejected', async () => {
    const r = await check(fakeProvider(activeRecord), { input: { ...signupInput, companyName: 'Rocket Hiring' } })
    assert.equal(r.reject, undefined)
    assert.equal(r.record.status, 'UNDER_REVIEW')
    assert.equal(r.code, 'PROFILE_NAME_DIFFERS')
  })

  test('not registered, inactive or wrong legal name → signup refused, nothing created', async () => {
    const cases = [
      [() => Promise.reject(new GstProviderError('NOT_FOUND')), 'GSTIN_NOT_FOUND'],
      [(g) => ({ ...activeRecord(g), registrationStatus: 'CANCELLED' }), 'INACTIVE_REGISTRATION'],
      [(g) => ({ ...activeRecord(g), legalName: 'Globex Private Limited' }), 'NAME_MISMATCH'],
    ]
    for (const [lookup, code] of cases) {
      const r = await check(fakeProvider(lookup))
      assert.equal(r.reject.httpStatus, 422, code)
      assert.equal(r.reject.code, code)
      assert.equal(r.record, undefined)
    }
  })

  test('API down, timeout, rate limit, exhausted credits, bad response → created pending (FAILED), never VERIFIED', async () => {
    const cases = [
      () => Promise.reject(new GstProviderError('UNAVAILABLE')),
      () => Promise.reject(new GstProviderError('AUTH', 'gstinapi.in HTTP 402 - no credits left')),
      () => Promise.reject(new GstProviderError('RATE_LIMITED')),
      () => new Promise(() => {}), // never answers -> timeout
      () => ({ gstin: GSTIN, registrationStatus: 'ACTIVE' }), // no legal name
    ]
    for (const lookup of cases) {
      const r = await check(fakeProvider(lookup))
      assert.equal(r.reject, undefined)
      assert.equal(r.record.status, 'FAILED')
      assert.notEqual(r.code, 'VERIFIED')
    }
  })

  test('inconclusive registration status → created pending manual review', async () => {
    const r = await check(fakeProvider((g) => ({ ...activeRecord(g), registrationStatus: 'UNKNOWN' })))
    assert.equal(r.record.status, 'UNDER_REVIEW')
  })

  test('no provider configured → created pending (NOT_SUBMITTED), never VERIFIED', async () => {
    const r = await check(null)
    assert.equal(r.record.status, 'NOT_SUBMITTED')
    assert.equal(r.code, 'GST_NOT_CONFIGURED')
  })

  test('GSTIN already held by another company → refused (409) without a provider call', async () => {
    const provider = fakeProvider(activeRecord)
    const r = await check(provider, { claimed: true })
    assert.equal(r.reject.httpStatus, 409)
    assert.equal(r.reject.code, 'GSTIN_ALREADY_REGISTERED')
    assert.equal(provider.calls, 0)
  })
})

describe('pending company renames itself while re-verifying', () => {
  test('a never-verified (e.g. pay-first guest) company can set its real name with the retry', async () => {
    const repo = memoryRepo()
    let claimedName
    const claim = repo.claim
    repo.claim = async (id, args) => ((claimedName = args.companyName), claim(id, args))
    const verify = createGstVerifier({ repo, getProvider: () => fakeProvider(activeRecord), timeoutMs: 50 })
    const res = await verify({ ...request, company: { _id: 'c9', name: 'New Employer Account' }, companyName: 'Acme Pvt Ltd' })
    assert.equal(claimedName, 'Acme Pvt Ltd')
    assert.equal(res.gstVerification.status, 'VERIFIED')
  })
})

describe('employer access gate', () => {
  test('public routes, pending-allowed routes, and default-deny for everything else', () => {
    assert.equal(classifyEmployerPath('POST', '/auth/signup'), 'public')
    assert.equal(classifyEmployerPath('POST', '/subscription/guest-order'), 'public')
    assert.equal(classifyEmployerPath('GET', '/company'), 'pendingOk')
    assert.equal(classifyEmployerPath('GET', '/Company/'), 'pendingOk')
    assert.equal(classifyEmployerPath('POST', '/company/verify-gst'), 'pendingOk')
    assert.equal(classifyEmployerPath('POST', '/support/tickets'), 'pendingOk')
    const gated = [['POST', '/jobs'], ['GET', '/jobs'], ['PUT', '/company'], ['GET', '/candidates'], ['POST', '/resume-search/x/unlock'], ['GET', '/credits'], ['POST', '/subscription/order'], ['GET', '/dashboard'], ['GET', '/some-future-route']]
    for (const [m, p] of gated) assert.equal(classifyEmployerPath(m, p), 'verified', m + ' ' + p)
  })

  const run = (mw, req) =>
    new Promise((resolve) => {
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(body) { resolve({ status: this.statusCode, body }) } }
      mw(req, res, () => resolve({ status: 'next' }))
    })

  test('pending, under-review, failed and never-submitted companies cannot post jobs or use the app', async () => {
    for (const status of ['NOT_SUBMITTED', 'PENDING', 'FAILED', 'UNDER_REVIEW', undefined]) {
      const r = await run(requireGstVerified, { company: { gstVerification: status ? { status } : undefined } })
      assert.equal(r.status, 403, String(status))
      assert.equal(r.body.code, 'GST_VERIFICATION_REQUIRED')
    }
    assert.equal((await run(requireGstVerified, { company: { gstVerification: { status: 'VERIFIED' } } })).status, 'next')
  })

  test('gate: public route needs no sign-in; a protected route without a token is 401', async () => {
    assert.equal((await run(employerAccessGate, { method: 'POST', path: '/auth/login', headers: {} })).status, 'next')
    assert.equal((await run(employerAccessGate, { method: 'POST', path: '/jobs', headers: {} })).status, 401)
  })

  test('gate: a signed-in pending employer reaches GST verification but not job posting', async () => {
    const pending = () => ({ headers: {}, user: { role: 'Admin' }, company: { gstVerification: { status: 'FAILED' } } })
    assert.equal((await run(employerAccessGate, { ...pending(), method: 'POST', path: '/company/verify-gst' })).status, 'next')
    assert.equal((await run(employerAccessGate, { ...pending(), method: 'POST', path: '/jobs' })).status, 403)
    const verified = { headers: {}, user: { role: 'Admin' }, company: { gstVerification: { status: 'VERIFIED' } } }
    assert.equal((await run(employerAccessGate, { ...verified, method: 'POST', path: '/jobs' })).status, 'next')
  })
})

describe('provider registry', () => {
  test('unknown, unregistered or credential-less providers resolve to null', () => {
    const ready = { name: 'x', isConfigured: () => true, lookup() {} }
    const noCreds = { name: 'y', isConfigured: () => false, lookup() {} }
    assert.equal(getGstProvider({}, ''), null)
    assert.equal(getGstProvider({ x: ready }, 'nope'), null)
    assert.equal(getGstProvider({ y: noCreds }, 'y'), null)
    assert.equal(getGstProvider({ x: ready }, 'x'), ready)
  })
})

describe('verify-gst authentication', () => {
  const call = (headers) =>
    new Promise((resolve, reject) => {
      const res = { statusCode: 200, status(c) { this.statusCode = c; return this }, json(body) { resolve({ status: this.statusCode, body }) } }
      requireAuth({ headers }, res, (err) => (err ? reject(err) : resolve({ status: 'next' })))
    })

  test('no token → 401', async () => {
    assert.equal((await call({})).status, 401)
  })
  test('a candidate (employee) token cannot be used on the employer endpoint → 401', async () => {
    const token = jwt.sign({ sub: 'x', type: 'employee' }, process.env.JWT_SECRET)
    assert.equal((await call({ authorization: `Bearer ${token}` })).status, 401)
  })
})
