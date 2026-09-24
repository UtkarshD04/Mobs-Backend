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
  todayIST,
  notExpiredClause,
  publicJobFilter,
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
    assert.equal(query.$and.length, 3)
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

describe('deadline expiry', () => {
  // 2026-09-20 20:00 UTC is already 21 Sept 01:30 in India.
  const lateEveningUtc = new Date('2026-09-20T20:00:00Z')

  test('todayIST rolls over on India time, not UTC', () => {
    assert.equal(todayIST(new Date('2026-09-20T10:00:00Z')), '2026-09-20')
    assert.equal(todayIST(lateEveningUtc), '2026-09-21')
  })

  test('keeps a job through its deadline day and drops it after', () => {
    const [noOrBadDeadline, dated] = notExpiredClause(new Date('2026-09-20T10:00:00Z')).$or
    assert.equal(dated.deadline.$gte, '2026-09-20')
    assert.ok(noOrBadDeadline.deadline.$not instanceof RegExp)
    assert.equal(notExpiredClause(lateEveningUtc).$or[1].deadline.$gte, '2026-09-21')
  })

  test('only date-shaped deadlines can expire a job', () => {
    const re = notExpiredClause().$or[0].deadline.$not
    assert.ok(re.test('2026-10-05'))
    assert.ok(!re.test('ASAP'))
    assert.ok(!re.test(''))
  })

  test('publicJobFilter is visible + public status + not expired, evaluated fresh each call', () => {
    const a = publicJobFilter(new Date('2026-01-01T00:00:00Z'))
    const b = publicJobFilter(new Date('2026-06-01T00:00:00Z'))
    assert.equal(a.visibleToCandidates, true)
    assert.deepEqual(a.status.$in, ['sourcing', 'delivered'])
    assert.notEqual(a.$and[0].$or[1].deadline.$gte, b.$and[0].$or[1].deadline.$gte)
  })

  test('buildJobQuery always carries the expiry clause', () => {
    const query = buildJobQuery(parseJobFilters({}))
    assert.equal(query.$and.length, 1)
    assert.ok(query.$and.at(-1).$or[1].deadline.$gte)
  })
})

describe('experienceYears and 15-day freshness', () => {
  test('parses a whole-number years value, rejects junk', () => {
    assert.equal(parseJobFilters({ experienceYears: '3' }).experienceYears, 3)
    assert.equal(parseJobFilters({ experienceYears: '0' }).experienceYears, 0)
    assert.equal(parseJobFilters({ experienceYears: '2.5' }).experienceYears, null)
    assert.equal(parseJobFilters({ experienceYears: '-1' }).experienceYears, null)
    assert.equal(parseJobFilters({ experienceYears: '99' }).experienceYears, null)
    assert.equal(parseJobFilters({ experienceYears: '{"$gt":0}' }).experienceYears, null)
    assert.equal(parseJobFilters({}).experienceYears, null)
  })

  test('experienceYears becomes a "range contains N" clause', () => {
    const query = buildJobQuery(parseJobFilters({ experienceYears: '3' }))
    assert.ok(query.$and.some((c) => c.experienceMin?.$lte === 3 && c.experienceMax?.$gte === 3))
  })

  test('accepts postedWithin=15', () => {
    assert.equal(parseJobFilters({ postedWithin: '15' }).postedWithinDays, 15)
  })
})
