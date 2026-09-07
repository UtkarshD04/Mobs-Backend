import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseCsv,
  parseJobFilters,
  experienceOverlapQuery,
  salaryOverlapQuery,
  postedWithinQuery,
  buildJobQuery,
  buildSortStage,
  escapeRegex,
} from './jobQueryFilters.js'

describe('parseCsv', () => {
  test('splits, trims, dedupes and drops empties', () => {
    assert.deepEqual(parseCsv('Remote, Hybrid,,Remote , On-site'), ['Remote', 'Hybrid', 'On-site'])
  })

  test('handles missing values', () => {
    assert.deepEqual(parseCsv(undefined), [])
    assert.deepEqual(parseCsv(''), [])
  })
})

describe('parseJobFilters allowlisting', () => {
  test('drops values not on the allowlist instead of passing them through', () => {
    const filters = parseJobFilters({ workMode: 'Remote,Moon', employmentType: 'Full-time,$where' })
    assert.deepEqual(filters.workMode, ['Remote'])
    assert.deepEqual(filters.employmentType, ['Full-time'])
  })

  test('rejects malformed company/id values instead of trusting them as ObjectIds', () => {
    const filters = parseJobFilters({ company: '507f1f77bcf86cd799439011,not-an-id', ids: '{"$ne":null}' })
    assert.deepEqual(filters.companyIds, ['507f1f77bcf86cd799439011'])
    assert.deepEqual(filters.ids, [])
  })

  test('accepts the legacy `search` param as an alias for `q`', () => {
    assert.deepEqual(parseJobFilters({ search: 'React Developer' }).q, ['React Developer'])
  })

  test('q and location are comma-separated term lists, for a multi-tag search box', () => {
    const filters = parseJobFilters({ q: 'Frontend Developer,React', location: 'Bengaluru,Remote' })
    assert.deepEqual(filters.q, ['Frontend Developer', 'React'])
    assert.deepEqual(filters.location, ['Bengaluru', 'Remote'])
  })

  test('caps the number of q/location terms a single request can carry', () => {
    const many = Array.from({ length: 20 }, (_, i) => `term${i}`).join(',')
    assert.equal(parseJobFilters({ q: many }).q.length, 10)
  })

  test('accepts `department` as an alias for `track`', () => {
    assert.deepEqual(parseJobFilters({ department: 'tech' }).track, ['tech'])
  })

  test('ignores an out-of-range postedWithin value', () => {
    assert.equal(parseJobFilters({ postedWithin: '9999' }).postedWithinDays, null)
    assert.equal(parseJobFilters({ postedWithin: '7' }).postedWithinDays, 7)
  })

  test('falls back to newest for an unknown sort value', () => {
    assert.equal(parseJobFilters({ sort: 'not-a-real-sort' }).sort, 'newest')
    assert.equal(parseJobFilters({ sort: 'relevance' }).sort, 'relevance')
  })
})

describe('experienceOverlapQuery', () => {
  test('a 2-4yr job overlaps a 1-3yr selection', () => {
    const query = experienceOverlapQuery(['1-3'])
    const job = { experienceMin: 2, experienceMax: 4 }
    const matches = query.$or.some((cond) => job.experienceMax >= cond.experienceMax.$gte && (!cond.experienceMin || job.experienceMin <= cond.experienceMin.$lte))
    assert.ok(matches)
  })

  test('a 5-7yr job does not overlap a 0-1yr selection', () => {
    const query = experienceOverlapQuery(['0-1'])
    const job = { experienceMin: 5, experienceMax: 7 }
    const matches = query.$or.some((cond) => job.experienceMax >= cond.experienceMax.$gte && (!cond.experienceMin || job.experienceMin <= cond.experienceMin.$lte))
    assert.ok(!matches)
  })

  test('10+ has no upper bound', () => {
    const query = experienceOverlapQuery(['10+'])
    assert.deepEqual(query.$or, [{ experienceMax: { $gte: 10 } }])
  })

  test('returns null when no ranges are selected', () => {
    assert.equal(experienceOverlapQuery([]), null)
  })
})

describe('salaryOverlapQuery', () => {
  test('a 5-9 LPA job overlaps the 6-10 LPA selection', () => {
    const query = salaryOverlapQuery(['6-10'])
    const job = { salaryMin: 500000, salaryMax: 900000 }
    const [cond] = query.$or
    assert.ok(job.salaryMax >= cond.salaryMax.$gte && job.salaryMin <= cond.salaryMin.$lte)
  })

  test('15+ has no upper bound', () => {
    const query = salaryOverlapQuery(['15+'])
    assert.deepEqual(query.$or, [{ salaryMax: { $gte: 1500000 } }])
  })
})

describe('postedWithinQuery', () => {
  test('returns null when unset', () => {
    assert.equal(postedWithinQuery(null), null)
  })

  test('builds a $gte cutoff roughly `days` ago', () => {
    const query = postedWithinQuery(7)
    const expected = Date.now() - 7 * 24 * 60 * 60 * 1000
    assert.ok(Math.abs(query.postedOn.$gte.getTime() - expected) < 5000)
  })
})

describe('escapeRegex', () => {
  test('neutralizes regex metacharacters so keyword search cannot be used for ReDoS/injection', () => {
    const escaped = escapeRegex('C++ (Senior).*')
    const regex = new RegExp(escaped, 'i')
    assert.ok(regex.test('C++ (Senior).*'))
    assert.ok(!regex.test('C plus plus Senior anything'))
  })
})

describe('buildJobQuery', () => {
  test('always scopes to candidate-visible, publicly-listed statuses', () => {
    const query = buildJobQuery(parseJobFilters({}))
    assert.equal(query.visibleToCandidates, true)
    assert.deepEqual(query.status.$in, ['sourcing', 'delivered'])
  })

  test('never lets a request smuggle raw Mongo operators into the query shape', () => {
    const filters = parseJobFilters({ workMode: '{"$ne": null}', track: '$where' })
    const query = buildJobQuery(filters)
    assert.equal(query.workMode, undefined)
    assert.equal(query.track, undefined)
  })

  test('combines q and location as separate AND-ed OR-clauses, not merged together', () => {
    const filters = parseJobFilters({ q: 'react', location: 'Bengaluru' })
    const query = buildJobQuery(filters)
    assert.equal(query.$and.length, 2)
  })

  test('folds a keyword-matched company id list into the q OR-clause', () => {
    const filters = parseJobFilters({ q: 'acme' })
    const query = buildJobQuery(filters, { matchingCompanyIdsForQ: ['507f1f77bcf86cd799439011'] })
    const orClause = query.$and[0].$or
    assert.ok(orClause.some((c) => c.company))
  })

  test('location=Remote also matches on workMode for the legacy marketing-site link', () => {
    const filters = parseJobFilters({ location: 'Remote' })
    const query = buildJobQuery(filters)
    const orClause = query.$and[0].$or
    assert.ok(orClause.some((c) => c.workMode?.$in?.includes('Remote')))
  })

  test('multiple q terms match a job whose title contains any one of them (OR, not AND)', () => {
    const filters = parseJobFilters({ q: 'Frontend Developer,Sales Executive' })
    const query = buildJobQuery(filters)
    const regex = query.$and[0].$or[0].title
    assert.ok(regex.test('Senior Frontend Developer'))
    assert.ok(regex.test('Sales Executive'))
    assert.ok(!regex.test('HR Manager'))
  })

  test('multiple location terms, mixing a city and Remote, match either', () => {
    const filters = parseJobFilters({ location: 'Bengaluru,Remote' })
    const query = buildJobQuery(filters)
    const orClause = query.$and[0].$or
    assert.ok(orClause[0].location.test('Bengaluru, Karnataka'))
    assert.ok(orClause.some((c) => c.workMode?.$in?.includes('Remote')))
  })

  test('skills filter is OR (any-of), matched case-insensitively as whole values', () => {
    const filters = parseJobFilters({ skills: 'React,Node.js' })
    const query = buildJobQuery(filters)
    assert.equal(query.skills.$in.length, 2)
    assert.ok(query.skills.$in[0] instanceof RegExp)
  })
})

describe('buildSortStage', () => {
  test('defaults to newest first', () => {
    assert.deepEqual(buildSortStage(parseJobFilters({})), { postedOn: -1 })
  })

  test('salary_desc sorts by salaryMax descending', () => {
    assert.deepEqual(buildSortStage(parseJobFilters({ sort: 'salary_desc' })), { salaryMax: -1, postedOn: -1 })
  })
})
