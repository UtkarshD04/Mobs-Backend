// Server-side geocoding proxy used by the employer dashboard's location filters and the
// job form's map picker. Talks to a Nominatim-compatible API (OpenStreetMap by default;
// LocationIQ etc. work via GEOCODER_BASE_URL + GEOCODER_API_KEY) and India Post's free
// PIN-code directory. Keys never reach the browser. Results are cached and requests are
// serialised ~1/second to respect the public Nominatim usage policy.
import axios from 'axios'
import { env } from '../config/env.js'
import { canonicalState } from './indiaStates.js'

const CACHE_TTL_MS = 15 * 60 * 1000
const CACHE_MAX = 500
const MIN_GAP_MS = env.geocoder.minGapMs
const cache = new Map()
let chain = Promise.resolve()
let lastCall = 0

export class GeocoderError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.status = status
  }
}

function cached(key, fn) {
  const hit = cache.get(key)
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.value)
  return fn().then((value) => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
    cache.set(key, { value, exp: Date.now() + CACHE_TTL_MS })
    return value
  })
}

// One upstream call at a time, at least MIN_GAP_MS apart.
function throttled(task) {
  const run = chain.then(async () => {
    const wait = lastCall + MIN_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastCall = Date.now()
    return task()
  })
  chain = run.catch(() => {})
  return run
}

async function nominatim(path, params) {
  if (!env.geocoder.enabled) throw new GeocoderError('Location search is not enabled on this server.', 503)
  try {
    const r = await axios.get(`${env.geocoder.baseUrl}${path}`, {
      params: { format: 'jsonv2', addressdetails: 1, 'accept-language': 'en', ...params, ...(env.geocoder.apiKey ? { key: env.geocoder.apiKey } : {}) },
      headers: { 'User-Agent': env.geocoder.userAgent },
      timeout: 8000,
    })
    return r.data
  } catch (e) {
    if (e.response?.status === 429) throw new GeocoderError('Location service is busy. Try again in a moment.', 503)
    throw new GeocoderError('Location service is unavailable right now.')
  }
}

function normalize(item) {
  const a = item.address ?? {}
  const lat = Number(item.lat)
  const lng = Number(item.lon)
  const pin = String(a.postcode ?? '').replace(/\s/g, '')
  return {
    label: item.display_name,
    country: a.country ?? '',
    state: a.state ? canonicalState(a.state) : a.state_district ? canonicalState(a.state_district) : '',
    city: a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? a.state_district ?? '',
    locality: a.suburb ?? a.neighbourhood ?? a.city_district ?? a.quarter ?? a.hamlet ?? a.residential ?? '',
    road: a.road ?? '',
    pincode: /^[1-9]\d{5}$/.test(pin) ? pin : '',
    lat,
    lng,
    // A geocoded address is only ever address-level; precision comes from a hand-placed pin.
    accuracy: 'approximate',
  }
}

const valid = (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)

export function searchPlaces({ q, state, city }) {
  const query = [q, city, state].filter(Boolean).join(', ')
  return cached(`s:${query.toLowerCase()}`, () =>
    throttled(async () => {
      const data = await nominatim('/search', { q: query, countrycodes: 'in', limit: 8, dedupe: 1 })
      return (Array.isArray(data) ? data : []).map(normalize).filter(valid)
    })
  )
}

export function reversePlace(lat, lng) {
  const key = `r:${lat.toFixed(5)},${lng.toFixed(5)}`
  return cached(key, () =>
    throttled(async () => {
      const data = await nominatim('/reverse', { lat, lon: lng, zoom: 18 })
      if (!data || data.error || !data.address) return null
      const p = normalize(data)
      return valid(p) ? p : null
    })
  )
}

// India Post directory: PIN → state, district and the post-office areas it covers.
export function lookupPincode(pin) {
  return cached(`p:${pin}`, async () => {
    try {
      const r = await axios.get(`${env.geocoder.pincodeApiUrl}/${pin}`, { timeout: 8000 })
      const entry = Array.isArray(r.data) ? r.data[0] : null
      if (!entry || entry.Status !== 'Success' || !entry.PostOffice?.length) return null
      const offices = entry.PostOffice
      return {
        pincode: pin,
        state: canonicalState(offices[0].State),
        district: offices[0].District ?? '',
        areas: [...new Set(offices.map((o) => o.Name).filter(Boolean))],
      }
    } catch {
      throw new GeocoderError('PIN code lookup is unavailable right now.')
    }
  })
}
