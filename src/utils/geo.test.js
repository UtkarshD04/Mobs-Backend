import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { citiesByDistance, sortJobsByDistance, EXTRA_CITIES } from './geo.js'

const LUCKNOW = { lat: 26.85, lng: 80.95 }

describe('nearby job sorting', () => {
  test('covers cities beyond the homepage hot-city list', () => {
    const slugs = citiesByDistance(LUCKNOW.lat, LUCKNOW.lng).map((c) => c.slug)
    assert.ok(slugs.includes('kanpur'))
    assert.ok(slugs.includes('varanasi'))
    assert.ok(EXTRA_CITIES.length >= 40)
  })

  test('sorts nearest first, unknown/remote locations last', () => {
    const jobs = [
      { location: 'Goa' },
      { location: 'Remote' },
      { location: 'Kanpur, Uttar Pradesh' },
      { location: 'Lucknow' },
      { location: 'Varanasi' },
    ]
    const sorted = sortJobsByDistance(jobs, LUCKNOW.lat, LUCKNOW.lng).map((j) => j.location)
    assert.deepEqual(sorted, ['Lucknow', 'Kanpur, Uttar Pradesh', 'Varanasi', 'Goa', 'Remote'])
  })

  test('short city names only match whole words', () => {
    const jobs = [{ location: 'Kotak Mahindra Tower, Nowhere' }, { location: 'Kota' }]
    const [first] = sortJobsByDistance(jobs, 25.2, 75.86)
    assert.equal(first.location, 'Kota')
  })
})
