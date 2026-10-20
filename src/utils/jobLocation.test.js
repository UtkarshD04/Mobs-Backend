import test from 'node:test'
import assert from 'node:assert/strict'
import {
  sanitizeLocationDetails,
  parseLocationFilters,
  buildGeoPipeline,
  shapeGeoRow,
  haversineMeters,
  PRECISE_RADIUS_BELOW_M,
} from './jobLocation.js'
import { canonicalState } from './indiaStates.js'

test('sanitize: undefined leaves untouched, null clears', () => {
  assert.deepEqual(sanitizeLocationDetails(undefined), { value: undefined })
  assert.deepEqual(sanitizeLocationDetails(null), { value: null })
})

test('sanitize: builds a GeoJSON point as [lng, lat] and defaults country', () => {
  const { value } = sanitizeLocationDetails({ state: 'karnataka', city: 'Bengaluru', lat: '12.97', lng: 77.59, source: 'map_pin', accuracy: 'precise', pincode: '560001' })
  assert.deepEqual(value.geo, { type: 'Point', coordinates: [77.59, 12.97] })
  assert.equal(value.state, 'Karnataka')
  assert.equal(value.country, 'India')
  assert.equal(value.accuracy, 'precise')
})

test('sanitize: a geocoded address can never be stored as precise', () => {
  const { value } = sanitizeLocationDetails({ lat: 12.97, lng: 77.59, source: 'geocoded_address', accuracy: 'precise' })
  assert.equal(value.accuracy, 'approximate')
  const noSource = sanitizeLocationDetails({ lat: 12.97, lng: 77.59, accuracy: 'precise' }).value
  assert.equal(noSource.accuracy, 'approximate')
})

test('sanitize: rejects bad PIN, out-of-India / non-numeric / half coordinates, non-text fields', () => {
  assert.ok(sanitizeLocationDetails({ pincode: '12345' }).error)
  assert.ok(sanitizeLocationDetails({ pincode: '012345' }).error)
  assert.ok(sanitizeLocationDetails({ lat: 51.5, lng: -0.12 }).error)
  assert.ok(sanitizeLocationDetails({ lat: 'x', lng: 77 }).error)
  assert.ok(sanitizeLocationDetails({ lat: 12.9 }).error)
  assert.ok(sanitizeLocationDetails({ city: { $ne: 1 } }).error)
  assert.ok(sanitizeLocationDetails([]).error)
})

test('state names are canonicalised', () => {
  assert.equal(canonicalState('NCT of Delhi'), 'Delhi')
  assert.equal(canonicalState('orissa'), 'Odisha')
  assert.equal(canonicalState('Somewhere'), 'Somewhere')
})

test('filters: no params → no clauses, no geo (existing behaviour untouched)', () => {
  assert.deepEqual(parseLocationFilters({ search: 'x', status: 'all' }), { clauses: [], geo: null })
})

test('filters: state/city/locality/pincode become anchored/escaped clauses; city also matches legacy text', () => {
  const { clauses } = parseLocationFilters({ state: 'Karnataka', city: 'Bengaluru (Urban)', locality: 'Koramangala', pincode: '560034' })
  assert.equal(clauses.length, 4)
  assert.ok(clauses[0]['locationDetails.state'].test('karnataka'))
  assert.ok(!clauses[0]['locationDetails.state'].test('Karnataka2'))
  assert.equal(clauses[1].$or.length, 2)
  assert.ok(clauses[1].$or[1].location.test('Bengaluru (Urban), KA'))
  assert.equal(clauses[3]['locationDetails.pincode'], '560034')
})

test('filters: validates PIN, coordinates and radius bounds', () => {
  assert.ok(parseLocationFilters({ pincode: '5600' }).error)
  assert.ok(parseLocationFilters({ lat: '12.9', lng: '77.5' }).error) // radius missing
  assert.ok(parseLocationFilters({ lat: '12.9', lng: '77.5', radius: '10' }).error)
  assert.ok(parseLocationFilters({ lat: '12.9', lng: '77.5', radius: '1000000' }).error)
  assert.ok(parseLocationFilters({ lat: '0', lng: '0', radius: '500' }).error)
  assert.ok(parseLocationFilters({ state: ['a'] }).error)
})

test('filters: sub-1km radius requires precise coordinates; both exclude Remote jobs', () => {
  const small = parseLocationFilters({ lat: '12.9716', lng: '77.5946', radius: '100' })
  assert.equal(small.geo.precisionOnly, true)
  assert.ok(small.clauses.some((c) => c['locationDetails.accuracy'] === 'precise'))
  assert.ok(small.clauses.some((c) => c.workMode?.$ne === 'Remote'))
  const big = parseLocationFilters({ lat: '12.9716', lng: '77.5946', radius: String(PRECISE_RADIUS_BELOW_M) })
  assert.equal(big.geo.precisionOnly, false)
  assert.ok(!big.clauses.some((c) => c['locationDetails.accuracy']))
})

test('pipeline: $geoNear first, metres, [lng, lat], paginated facet', () => {
  const p = buildGeoPipeline({ company: 'c' }, { lat: 12.9, lng: 77.5, radius: 250 }, { skip: 10, limit: 5 })
  assert.deepEqual(p[0].$geoNear.near.coordinates, [77.5, 12.9])
  assert.equal(p[0].$geoNear.maxDistance, 250)
  assert.equal(p[0].$geoNear.spherical, true)
  assert.deepEqual(p[2].$facet.data, [{ $skip: 10 }, { $limit: 5 }])
})

test('shapeGeoRow: id string, no _id/__v, rounded distance', () => {
  const r = shapeGeoRow({ _id: { toString: () => 'abc' }, __v: 0, title: 't', distanceMeters: 123.6 })
  assert.deepEqual(r, { title: 't', id: 'abc', distanceMeters: 124 })
})

test('haversine: ~111.2 km per degree of latitude, 0 for same point', () => {
  assert.equal(haversineMeters({ lat: 1, lng: 1 }, { lat: 1, lng: 1 }), 0)
  const d = haversineMeters({ lat: 12, lng: 77 }, { lat: 13, lng: 77 })
  assert.ok(Math.abs(d - 111195) < 200)
})
