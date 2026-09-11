import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateCategoryHighlights, CATEGORIES } from './categoryHighlights.js'

const verifiedCo = (id) => ({ _id: id, verificationStatus: 'verified' })

function job(overrides = {}) {
  return {
    title: 'Frontend Developer',
    track: 'tech',
    department: 'Engineering',
    experienceMin: 2,
    workMode: 'Hybrid',
    salaryMin: 500000,
    salaryMax: 1000000,
    postedOn: new Date().toISOString(),
    company: verifiedCo('c1'),
    ...overrides,
  }
}

describe('aggregateCategoryHighlights', () => {
  test('returns one entry per curated category, in order', () => {
    const result = aggregateCategoryHighlights([])
    assert.equal(result.length, CATEGORIES.length)
    assert.equal(result[0].key, 'tech')
  })

  test('a category with no matching jobs gets real zeros, not fabricated numbers', () => {
    const result = aggregateCategoryHighlights([])
    const tech = result.find((c) => c.key === 'tech')
    assert.deepEqual(tech, { key: 'tech', openings: 0, topRoles: [], salaryMin: null, salaryMax: null, verifiedEmployers: 0, newThisWeek: 0, workModes: [] })
  })

  test('counts openings only for jobs whose track actually matches', () => {
    const jobs = [job({ track: 'tech' }), job({ track: 'sales' }), job({ track: 'tech' })]
    const result = aggregateCategoryHighlights(jobs)
    assert.equal(result.find((c) => c.key === 'tech').openings, 2)
    assert.equal(result.find((c) => c.key === 'sales').openings, 1)
  })

  test('finance has no track value — matched by department text instead', () => {
    const jobs = [job({ track: '', department: 'Finance & Accounting' }), job({ track: '', department: 'Engineering' })]
    const result = aggregateCategoryHighlights(jobs)
    assert.equal(result.find((c) => c.key === 'finance').openings, 1)
  })

  test('freshers matches by experienceMin, not track', () => {
    const jobs = [job({ experienceMin: 0, track: 'sales' }), job({ experienceMin: 1, track: 'ops' }), job({ experienceMin: 3, track: 'tech' })]
    const result = aggregateCategoryHighlights(jobs)
    assert.equal(result.find((c) => c.key === 'freshers').openings, 2)
  })

  test('remote matches by workMode, not track', () => {
    const jobs = [job({ workMode: 'Remote', track: 'design' }), job({ workMode: 'On-site', track: 'design' })]
    const result = aggregateCategoryHighlights(jobs)
    assert.equal(result.find((c) => c.key === 'remote').openings, 1)
  })

  test('popular roles are the real, most frequent titles with their real counts', () => {
    const jobs = [job({ title: 'Frontend Developer' }), job({ title: 'Frontend Developer' }), job({ title: 'Backend Engineer' })]
    const result = aggregateCategoryHighlights(jobs)
    assert.deepEqual(result.find((c) => c.key === 'tech').topRoles, [
      { title: 'Frontend Developer', count: 2 },
      { title: 'Backend Engineer', count: 1 },
    ])
  })

  test('salary range is the real min/max across matched jobs, ignoring jobs with no salary set', () => {
    const jobs = [job({ salaryMin: 300000, salaryMax: 600000 }), job({ salaryMin: 900000, salaryMax: 1800000 }), job({ salaryMin: 0, salaryMax: 0 })]
    const result = aggregateCategoryHighlights(jobs)
    const tech = result.find((c) => c.key === 'tech')
    assert.equal(tech.salaryMin, 300000)
    assert.equal(tech.salaryMax, 1800000)
  })

  test('verifiedEmployers counts distinct verified companies only', () => {
    const jobs = [job({ company: verifiedCo('c1') }), job({ company: verifiedCo('c1') }), job({ company: { _id: 'c2', verificationStatus: 'pending' } })]
    const result = aggregateCategoryHighlights(jobs)
    assert.equal(result.find((c) => c.key === 'tech').verifiedEmployers, 1)
  })

  test('newThisWeek counts jobs posted within the last 7 days', () => {
    const now = Date.now()
    const jobs = [job({ postedOn: new Date(now - 2 * 86400000).toISOString() }), job({ postedOn: new Date(now - 20 * 86400000).toISOString() })]
    const result = aggregateCategoryHighlights(jobs, { now })
    assert.equal(result.find((c) => c.key === 'tech').newThisWeek, 1)
  })
})
