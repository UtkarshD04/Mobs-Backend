process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'unit-test-secret'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
const { createGstinApiProvider, mapRegistrationStatus } = await import('./gstProviders/gstinapi.js')
const { GstProviderError } = await import('./gstProviderError.js')

// Response bodies follow the vendor's OpenAPI spec (LookupSuccess /
// ErrorResponse) — see the header comment in gstinapi.js. No network here.
const SAMPLE = {
  success: true,
  gstin: '00AAAAA0000A1ZT',
  data: {
    gstin: '00AAAAA0000A1ZT',
    legal_name: 'GSTINAPI TEST PRIVATE LIMITED',
    trade_name: 'GSTINAPI SANDBOX',
    status: 'Active',
    taxpayer_type: 'Regular',
    address: '1, Test Building, Test Street, Test Locality',
  },
  credits_remaining: 99,
}

function provider(response, { apiKey = 'gak_test', baseUrl = '' } = {}) {
  const calls = []
  const http = {
    async get(url, opts) {
      calls.push({ url, opts })
      if (response instanceof Error) throw response
      return response
    },
  }
  return { p: createGstinApiProvider({ http, config: () => ({ apiKey, baseUrl }) }), calls }
}

describe('gstinapi.in adapter', () => {
  test('calls GET /v1/gstin/:gstin with the x-api-key header and maps the record', async () => {
    const { p, calls } = provider({ status: 200, data: SAMPLE }, { baseUrl: 'https://www.gstinapi.in/' })
    const r = await p.lookup('00AAAAA0000A1ZT', { signal: 'sig' })
    assert.equal(calls[0].url, 'https://www.gstinapi.in/v1/gstin/00AAAAA0000A1ZT')
    assert.equal(calls[0].opts.headers['x-api-key'], 'gak_test')
    assert.equal(calls[0].opts.signal, 'sig')
    assert.deepEqual(r, {
      gstin: '00AAAAA0000A1ZT',
      legalName: 'GSTINAPI TEST PRIVATE LIMITED',
      tradeName: 'GSTINAPI SANDBOX',
      registrationStatus: 'ACTIVE',
      address: '1, Test Building, Test Street, Test Locality',
      providerReference: '',
    })
  })

  test('defaults to the documented production host', async () => {
    const { p, calls } = provider({ status: 200, data: SAMPLE })
    await p.lookup('00AAAAA0000A1ZT')
    assert.equal(calls[0].url, 'https://gstinapi.in/v1/gstin/00AAAAA0000A1ZT')
  })

  test('maps every documented error status to a provider error code', async () => {
    const cases = { 401: 'AUTH', 402: 'AUTH', 403: 'AUTH', 404: 'NOT_FOUND', 429: 'RATE_LIMITED', 502: 'UNAVAILABLE', 400: 'UNAVAILABLE', 500: 'UNAVAILABLE' }
    for (const [status, code] of Object.entries(cases)) {
      const { p } = provider({ status: Number(status), data: { success: false, error: 'x' } })
      await assert.rejects(p.lookup('00AAAAA0000A1ZT'), (e) => e instanceof GstProviderError && e.code === code, `HTTP ${status}`)
    }
  })

  test('a 200 without success:true or data is not trusted', async () => {
    for (const body of [{ success: false }, { success: true }, 'oops', null]) {
      const { p } = provider({ status: 200, data: body })
      await assert.rejects(p.lookup('00AAAAA0000A1ZT'), (e) => e.code === 'UNAVAILABLE')
    }
  })

  test('aborts and network failures', async () => {
    const aborted = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED', name: 'CanceledError' })
    await assert.rejects(provider(aborted).p.lookup('x'), (e) => e.code === 'TIMEOUT')
    await assert.rejects(provider(Object.assign(new Error('dns'), { code: 'ENOTFOUND' })).p.lookup('x'), (e) => e.code === 'UNAVAILABLE')
  })

  test('isConfigured needs an API key', () => {
    assert.equal(provider({}, { apiKey: '' }).p.isConfigured(), false)
    assert.equal(provider({}).p.isConfigured(), true)
  })

  test('registration status text', () => {
    assert.equal(mapRegistrationStatus('Active'), 'ACTIVE')
    assert.equal(mapRegistrationStatus('Cancelled suo-moto'), 'CANCELLED')
    assert.equal(mapRegistrationStatus('Suspended'), 'SUSPENDED')
    assert.equal(mapRegistrationStatus('Inactive'), 'INACTIVE')
    assert.equal(mapRegistrationStatus('Provisional'), 'UNKNOWN')
    assert.equal(mapRegistrationStatus(null), 'UNKNOWN')
  })
})
