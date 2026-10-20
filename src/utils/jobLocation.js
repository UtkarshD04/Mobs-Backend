// Pure helpers for the employer dashboard's hierarchical / geospatial job-location
// filters. No DB access here, so validation and query building are unit-testable
// (see jobLocation.test.js). Job.location (free text) stays the source for legacy
// jobs; Job.locationDetails is the optional structured, geocoded extension.
import { escapeRegex } from './jobQueryFilters.js'
import { INDIA_STATES, canonicalState } from './indiaStates.js'

export const MIN_RADIUS_M = 50
export const MAX_RADIUS_M = 25000
// A radius below this is a "precision" search: only jobs whose coordinates were
// pinned on a map / taken from a device (accuracy 'precise') may match. A geocoded
// street address is not good enough to claim "within 500 m".
export const PRECISE_RADIUS_BELOW_M = 1000

// Generous bounding box for India — rejects arbitrary coordinates elsewhere (the
// only supported country today) without clipping any real Indian location.
const INDIA_BOUNDS = { minLat: 6, maxLat: 38, minLng: 68, maxLng: 98 }

export const ACCURACIES = ['precise', 'approximate']
export const SOURCES = ['map_pin', 'device_location', 'geocoded_address']
const PIN_RE = /^[1-9]\d{5}$/
const TEXT_FIELDS = ['country', 'state', 'city', 'locality', 'landmark', 'formattedAddress', 'originalAddress']
const MAX_TEXT = 250

export function isIndianCoord(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= INDIA_BOUNDS.minLat &&
    lat <= INDIA_BOUNDS.maxLat &&
    lng >= INDIA_BOUNDS.minLng &&
    lng <= INDIA_BOUNDS.maxLng
  )
}

function num(v) {
  if (v === '' || v === null || v === undefined) return NaN
  return Number(v)
}

export function haversineMeters(a, b) {
  const R = 6371008.8
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Validates the `locationDetails` a client sends on create/update.
 * Returns { value } — `undefined` leaves the job untouched, `null` clears it — or { error }.
 */
export function sanitizeLocationDetails(input) {
  if (input === undefined) return { value: undefined }
  if (input === null) return { value: null }
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'locationDetails must be an object' }

  const out = {}
  for (const f of TEXT_FIELDS) {
    const v = input[f]
    if (v === undefined || v === null || v === '') continue
    if (typeof v !== 'string') return { error: `locationDetails.${f} must be text` }
    out[f] = v.trim().slice(0, MAX_TEXT)
  }
  if (out.state) out.state = canonicalState(out.state)

  if (input.pincode !== undefined && input.pincode !== null && input.pincode !== '') {
    const pin = String(input.pincode).trim()
    if (!PIN_RE.test(pin)) return { error: 'PIN code must be 6 digits' }
    out.pincode = pin
  }

  const hasCoords = input.lat !== undefined && input.lat !== null && input.lat !== ''
  if (hasCoords || (input.lng !== undefined && input.lng !== null && input.lng !== '')) {
    const lat = num(input.lat)
    const lng = num(input.lng)
    if (!isIndianCoord(lat, lng)) return { error: 'Coordinates are invalid or outside India' }
    const source = SOURCES.includes(input.source) ? input.source : 'geocoded_address'
    // The client may only *claim* precision when the point really was chosen by hand
    // or read from the device; a geocoded address is always stored as approximate.
    const claimedPrecise = input.accuracy === 'precise' && (source === 'map_pin' || source === 'device_location')
    out.geo = { type: 'Point', coordinates: [lng, lat] }
    out.accuracy = claimedPrecise ? 'precise' : 'approximate'
    out.source = source
  }

  if (!out.country && (out.state || out.city || out.geo)) out.country = 'India'
  return { value: Object.keys(out).length ? out : null }
}

/**
 * Parses + validates the location part of GET /jobs.
 *   state, city, locality, pincode  → text/PIN filters on locationDetails
 *   lat, lng, radius (metres)       → geospatial filter (all three required together)
 * Returns { clauses, geo } or { error }. `clauses` are meant to be pushed onto `$and`.
 */
export function parseLocationFilters(query = {}) {
  const clauses = []
  const exact = (path, raw) => ({ [path]: new RegExp(`^${escapeRegex(raw)}$`, 'i') })
  const text = (key) => {
    const v = query[key]
    if (v === undefined || v === '') return ''
    if (typeof v !== 'string' || v.length > MAX_TEXT) return null
    return v.trim()
  }

  const state = text('state')
  const city = text('city')
  const locality = text('locality')
  if (state === null || city === null || locality === null) return { error: 'Invalid location filter' }

  if (state) clauses.push(exact('locationDetails.state', canonicalState(state)))
  // Legacy jobs only have the free-text `location`, so a city also matches it —
  // otherwise jobs posted before this feature would vanish from city searches.
  if (city) {
    clauses.push({ $or: [exact('locationDetails.city', city), { location: new RegExp(escapeRegex(city), 'i') }] })
  }
  if (locality) clauses.push({ 'locationDetails.locality': new RegExp(escapeRegex(locality), 'i') })

  if (query.pincode !== undefined && query.pincode !== '') {
    const pin = String(query.pincode).trim()
    if (!PIN_RE.test(pin)) return { error: 'PIN code must be 6 digits' }
    clauses.push({ 'locationDetails.pincode': pin })
  }

  let geo = null
  const hasGeoParam = ['lat', 'lng', 'radius'].some((k) => query[k] !== undefined && query[k] !== '')
  if (hasGeoParam) {
    const lat = num(query.lat)
    const lng = num(query.lng)
    const radius = num(query.radius)
    if (!isIndianCoord(lat, lng)) return { error: 'lat/lng are invalid or outside India' }
    if (!Number.isFinite(radius) || radius < MIN_RADIUS_M || radius > MAX_RADIUS_M) {
      return { error: `radius must be between ${MIN_RADIUS_M} and ${MAX_RADIUS_M} metres` }
    }
    geo = { lat, lng, radius, precisionOnly: radius < PRECISE_RADIUS_BELOW_M }
    // Remote jobs have no physical workplace, so the employer's office coordinates must not match.
    clauses.push({ workMode: { $ne: 'Remote' } })
    if (geo.precisionOnly) clauses.push({ 'locationDetails.accuracy': 'precise' })
  }

  return { clauses, geo }
}

/** Mongo pipeline for one page of jobs inside the radius, nearest first, plus the total. */
export function buildGeoPipeline(query, { lat, lng, radius }, { skip, limit }) {
  return [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distanceMeters',
        maxDistance: radius,
        spherical: true,
        key: 'locationDetails.geo',
        query,
      },
    },
    { $sort: { distanceMeters: 1, updatedOn: -1, _id: 1 } },
    { $facet: { data: [{ $skip: skip }, { $limit: limit }], total: [{ $count: 'n' }] } },
  ]
}

/** Aggregation row → the same shape Job's toJSON produces, with a rounded distance. */
export function shapeGeoRow(row) {
  const { _id, __v, distanceMeters, ...rest } = row
  return { ...rest, id: String(_id), distanceMeters: Math.round(distanceMeters) }
}

export { INDIA_STATES }
