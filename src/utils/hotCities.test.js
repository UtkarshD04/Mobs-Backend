import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateHotCities, HOT_CITIES, CATEGORY_FILTERS } from './hotCities.js'

const verifiedCo = (id) => ({ _id: id, verificationStatus: 'verified' })
const pendingCo = (id) => ({ _id: id, verificationStatus: 'pending' })

function job(overrides = {}) {
  return {
    location: 'Bengaluru, Karnataka',
    track: 'tech',
    department: 'Engineering',
    salaryMin: 500000,
    salaryMax: 1000000,
    postedOn: new Date().toISOString(),
    company: verifiedCo('c1'),
    ...overrides,
  }
}

describe('aggregateHotCities', () => {
  test('returns one entry per curated city, in order', () => {
    const result = aggregateHotCities([])
    assert.equal(result.length, HOT_CITIES.length)
    assert.equal(result[0].city, 'Bengaluru')
    assert.equal(result[0].slug, 'bengaluru')
  })

  test('a city with no matching jobs gets real zeros, not fabricated numbers', () => {
    const result = aggregateHotCities([])
    const bengaluru = result.find((c) => c.city === 'Bengaluru')
    assert.deepEqual(bengaluru.byFilter.all, { openings: 0, topCategories: [], salaryMin: null, salaryMax: null, verifiedEmployers: 0, newThisWeek: 0 })
  })

  test('counts openings only for jobs whose location actually matches the city', () => {
    const jobs = [job({ location: 'Bengaluru' }), job({ location: 'Mumbai' }), job({ location: 'Bangalore' })]
    const result = aggregateHotCities(jobs)
    assert.equal(result.find((c) => c.city === 'Bengaluru').byFilter.all.openings, 2)
    assert.equal(result.find((c) => c.city === 'Mumbai').byFilter.all.openings, 1)
  })

  test('the "all" bucket ignores track, category buckets filter by it', () => {
    const jobs = [job({ track: 'tech' }), job({ track: 'sales' }), job({ track: 'ops' })]
    const result = aggregateHotCities(jobs)
    const bengaluru = result.find((c) => c.city === 'Bengaluru').byFilter
    assert.equal(bengaluru.all.openings, 3)
    assert.equal(bengaluru.tech.openings, 1)
    assert.equal(bengaluru.sales.openings, 1)
  })

  test('finance has no track value — matched by department text instead', () => {
    const jobs = [job({ track: '', department: 'Finance & Accounting' }), job({ track: '', department: 'Engineering' })]
    const result = aggregateHotCities(jobs)
    assert.equal(result.find((c) => c.city === 'Bengaluru').byFilter.finance.openings, 1)
  })

  test('salary range is the real min/max across matched jobs, ignoring jobs with no salary set', () => {
    const jobs = [job({ salaryMin: 300000, salaryMax: 600000 }), job({ salaryMin: 900000, salaryMax: 1800000 }), job({ salaryMin: 0, salaryMax: 0 })]
    const result = aggregateHotCities(jobs)
    const stats = result.find((c) => c.city === 'Bengaluru').byFilter.all
    assert.equal(stats.salaryMin, 300000)
    assert.equal(stats.salaryMax, 1800000)
  })

  test('top categories are real department values ranked by frequency, capped at 3', () => {
    const jobs = [
      job({ department: 'Engineering' }),
      job({ department: 'Engineering' }),
      job({ department: 'Product' }),
      job({ department: 'Design' }),
      job({ department: 'Sales' }),
    ]
    const result = aggregateHotCities(jobs)
    const top = result.find((c) => c.city === 'Bengaluru').byFilter.all.topCategories
    assert.equal(top.length, 3)
    assert.equal(top[0], 'Engineering')
  })

  test('verified-employer count is distinct companies actually marked verified, not a raw job count', () => {
    const jobs = [
      job({ company: verifiedCo('a') }),
      job({ company: verifiedCo('a') }), // same company again — still one
      job({ company: verifiedCo('b') }),
      job({ company: pendingCo('c') }), // not verified — excluded
    ]
    const result = aggregateHotCities(jobs)
    assert.equal(result.find((c) => c.city === 'Bengaluru').byFilter.all.verifiedEmployers, 2)
  })

  test('newThisWeek only counts jobs posted within the last 7 days of `now`', () => {
    const now = Date.now()
    const jobs = [
      job({ postedOn: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString() }), // 2 days ago
      job({ postedOn: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString() }), // 20 days ago
    ]
    const result = aggregateHotCities(jobs, { now })
    assert.equal(result.find((c) => c.city === 'Bengaluru').byFilter.all.newThisWeek, 1)
  })

  test('CATEGORY_FILTERS always starts with "all"', () => {
    assert.equal(CATEGORY_FILTERS[0].key, 'all')
  })
})
