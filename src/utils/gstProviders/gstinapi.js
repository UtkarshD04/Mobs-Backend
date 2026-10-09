import axios from 'axios'
import { env } from '../../config/env.js'
import { GstProviderError } from '../gstProviderError.js'

// gstinapi.in adapter — written against the vendor's published OpenAPI spec
// (https://www.gstinapi.in/openapi.json):
//   GET {baseUrl}/v1/gstin/{gstin}   header: x-api-key
//   200 → { success: true, gstin, data: { legal_name, trade_name, status: 'Active', address, … }, credits_remaining, … }
//   400 bad format · 401 bad key · 402 out of credits · 403 account deactivated
//   404 not registered · 429 rate limited · 502 upstream GST network down
//   errors → { success: false, error: '…' }
// Free sandbox GSTIN 00AAAAA0000A1ZT answers in the live shape and is never charged.

const DEFAULT_BASE_URL = 'https://gstinapi.in'

// The spec shows `status` as free text ("Active"); anything we can't place
// with certainty becomes UNKNOWN, which the service sends to staff review.
export function mapRegistrationStatus(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (s === 'active') return 'ACTIVE'
  if (s.includes('cancel')) return 'CANCELLED'
  if (s.includes('suspend')) return 'SUSPENDED'
  if (s === 'inactive') return 'INACTIVE'
  return 'UNKNOWN'
}

const HTTP_TO_CODE = { 401: 'AUTH', 402: 'AUTH', 403: 'AUTH', 404: 'NOT_FOUND', 429: 'RATE_LIMITED' }
const HTTP_NOTE = { 401: 'API key rejected', 402: 'gstinapi.in account has no credits left', 403: 'gstinapi.in account deactivated' }

export function createGstinApiProvider({ http = axios, config = () => env.gstVerification } = {}) {
  return {
    name: 'gstinapi',

    isConfigured() {
      return Boolean(config().apiKey)
    },

    async lookup(gstin, { signal } = {}) {
      const { apiKey, baseUrl } = config()
      let res
      try {
        res = await http.get(`${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1/gstin/${encodeURIComponent(gstin)}`, {
          headers: { 'x-api-key': apiKey, accept: 'application/json' },
          signal,
          // Every status is inspected below rather than thrown by axios.
          validateStatus: () => true,
        })
      } catch (err) {
        if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') throw new GstProviderError('TIMEOUT', 'gstinapi.in request aborted')
        if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT') throw new GstProviderError('TIMEOUT', 'gstinapi.in request timed out')
        throw new GstProviderError('UNAVAILABLE', `gstinapi.in unreachable (${err?.code ?? 'network error'})`)
      }

      if (res.status !== 200) {
        const code = HTTP_TO_CODE[res.status] ?? 'UNAVAILABLE'
        throw new GstProviderError(code, `gstinapi.in HTTP ${res.status}${HTTP_NOTE[res.status] ? ` — ${HTTP_NOTE[res.status]}` : ''}`)
      }

      const body = res.data
      const data = body?.data
      if (body?.success !== true || !data || typeof data !== 'object') throw new GstProviderError('UNAVAILABLE', 'gstinapi.in returned an unexpected body')

      // Only the fields the verification needs — nothing else from the payload is kept.
      return {
        gstin: data.gstin ?? body.gstin ?? '',
        legalName: data.legal_name ?? '',
        tradeName: data.trade_name ?? '',
        registrationStatus: mapRegistrationStatus(data.status),
        address: data.address ?? '',
        providerReference: '', // the API documents no request/transaction id
      }
    },
  }
}

export default createGstinApiProvider()
