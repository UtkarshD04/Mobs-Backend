import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateHiringCompanies, aggregateAllCompanies } from './hiringCompanies.js'

function job(overrides = {}) {
  return {
    track: 'tech',
    department: 'Engineering',
    location: 'Bengaluru',
    workMode: 'Hybrid',
    company: { _id: 'c1', name: 'Acme', logo: '', website: '', verificationStatus: 'verified', blocked: false },
    ...overrides,
  }
}

describe('aggregateHiringCompanies', () => {
  test('a company with zero jobs never appears — there is nothing to fabricate', () => {
    assert.deepEqual(aggregateHiringCompanies([]), [])
  })

  test('groups jobs by company and counts real active jobs', () => {
    const jobs = [job(), job(), job({ company: { _id: 'c2', name: 'Beta', verificationStatus: 'pending', blocked: false } })]
    const result = aggregateHiringCompanies(jobs)
    assert.equal(result.length, 2)
    assert.equal(result.find((c) => c.name === 'Acme').activeJobs, 2)
    assert.equal(result.find((c) => c.name === 'Beta').activeJobs, 1)
  })

  test('sorted by activeJobs descending', () => {
    const jobs = [
      job({ company: { _id: 'c1', name: 'Small', verificationStatus: 'verified', blocked: false } }),
      job({ company: { _id: 'c2', name: 'Big', verificationStatus: 'verified', blocked: false } }),
      job({ company: { _id: 'c2', name: 'Big', verificationStatus: 'verified', blocked: false } }),
    ]
    const result = aggregateHiringCompanies(jobs)
    assert.deepEqual(result.map((c) => c.name), ['Big', 'Small'])
  })

  test('blocked companies are excluded even if they have live jobs', () => {
    const jobs = [job({ company: { _id: 'c1', name: 'Acme', verificationStatus: 'verified', blocked: true } })]
    assert.deepEqual(aggregateHiringCompanies(jobs), [])
  })

  test('verified reflects the real Company.verificationStatus, never assumed true', () => {
    const jobs = [job({ company: { _id: 'c1', name: 'Acme', verificationStatus: 'pending', blocked: false } })]
    assert.equal(aggregateHiringCompanies(jobs)[0].verified, false)
  })

  test('categories are derived from real track/department values, not invented', () => {
    const jobs = [job({ track: 'tech' }), job({ track: 'sales' }), job({ track: '', department: 'Finance & Accounting' })]
    const categories = aggregateHiringCompanies(jobs)[0].categories
    assert.deepEqual(categories, ['tech', 'sales', 'finance'])
  })

  test('locations are the real, deduplicated set of job locations, capped at 4', () => {
    const jobs = [job({ location: 'Bengaluru' }), job({ location: 'Bengaluru' }), job({ location: 'Mumbai' }), job({ location: 'Pune' }), job({ location: 'Delhi' }), job({ location: 'Chennai' })]
    const locations = aggregateHiringCompanies(jobs)[0].locations
    assert.equal(locations.length, 4)
    assert.deepEqual(locations, ['Bengaluru', 'Mumbai', 'Pune', 'Delhi'])
  })

  test('workModes is the real, deduplicated set of Job.workMode values', () => {
    const jobs = [job({ workMode: 'Hybrid' }), job({ workMode: 'Hybrid' }), job({ workMode: 'Remote' }), job({ workMode: 'On-site' })]
    const workModes = aggregateHiringCompanies(jobs)[0].workModes
    assert.deepEqual(workModes, ['Hybrid', 'Remote', 'On-site'])
  })

  test('remoteAvailable is true only when a real job has workMode Remote', () => {
    const onSite = aggregateHiringCompanies([job({ workMode: 'On-site' })])
    assert.equal(onSite[0].remoteAvailable, false)
    const remote = aggregateHiringCompanies([job({ workMode: 'On-site' }), job({ workMode: 'Remote' })])
    assert.equal(remote[0].remoteAvailable, true)
  })

  test('jobs with no company (or a missing populate) are skipped, not crashed on', () => {
    const jobs = [job({ company: null }), job()]
    const result = aggregateHiringCompanies(jobs)
    assert.equal(result.length, 1)
    assert.equal(result[0].activeJobs, 1)
  })
})

function company(overrides = {}) {
  return { _id: 'c1', name: 'Acme', logo: '', website: '', verificationStatus: 'verified', blocked: false, ...overrides }
}

describe('aggregateAllCompanies', () => {
  test('a company with zero live jobs still appears, with activeJobs: 0', () => {
    const result = aggregateAllCompanies([company()], [])
    assert.equal(result.length, 1)
    assert.equal(result[0].activeJobs, 0)
    assert.equal(result[0].hiringStatus, 'onboarded')
  })

  test('blocked companies are excluded even with no jobs at all', () => {
    assert.deepEqual(aggregateAllCompanies([company({ blocked: true })], []), [])
  })

  test('a company with live jobs is counted and marked active', () => {
    const companies = [company()]
    const jobs = [job(), job()]
    const result = aggregateAllCompanies(companies, jobs)
    assert.equal(result[0].activeJobs, 2)
    assert.equal(result[0].hiringStatus, 'active')
  })

  test('sorted by activeJobs desc, then by name for ties (including all-zero ties)', () => {
    const companies = [company({ _id: 'c2', name: 'Zeta' }), company({ _id: 'c1', name: 'Acme' }), company({ _id: 'c3', name: 'Beta' })]
    const result = aggregateAllCompanies(companies, [])
    assert.deepEqual(result.map((c) => c.name), ['Acme', 'Beta', 'Zeta'])
  })

  test('a job whose company was blocked/removed after posting does not crash the count', () => {
    const result = aggregateAllCompanies([company()], [job({ company: { _id: 'c-other', name: 'Other' } })])
    assert.equal(result[0].activeJobs, 0)
  })
})
