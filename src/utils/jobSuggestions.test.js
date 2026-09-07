import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { matchRank, buildSuggestions, buildGroupedSuggestions, MAX_SUGGESTIONS } from './jobSuggestions.js'

describe('matchRank', () => {
  test('ranks exact, starts-with, contains, and no-match', () => {
    assert.equal(matchRank('React Developer', 'react developer'), 0)
    assert.equal(matchRank('React Developer', 'react'), 1)
    assert.equal(matchRank('Senior React Developer', 'react'), 2)
    assert.equal(matchRank('Backend Developer', 'xyz'), null)
  })

  test('treats an empty query as a universal (low-priority) match, not a non-match', () => {
    assert.equal(matchRank('Remote', ''), 2)
  })
})

describe('buildSuggestions', () => {
  const liveRows = [
    { value: 'Frontend Developer', count: 18 },
    { value: 'React Developer', count: 12 },
    { value: 'Software Engineer', count: 35 },
  ]

  test('with no query, sorts live rows by count descending', () => {
    const items = buildSuggestions({ liveRows, query: '', limit: 10 })
    assert.deepEqual(items.map((i) => i.value), ['Software Engineer', 'Frontend Developer', 'React Developer'])
  })

  test('pads with curated entries only once live rows run out, tagging them distinctly', () => {
    const items = buildSuggestions({ liveRows, curatedValues: ['HR Executive', 'Frontend Developer'], query: '', limit: 5 })
    // "Frontend Developer" already exists live — the curated duplicate must not appear twice.
    assert.equal(items.filter((i) => i.value === 'Frontend Developer').length, 1)
    assert.deepEqual(
      items.map((i) => i.source),
      ['live', 'live', 'live', 'curated']
    )
    assert.equal(items.at(-1).value, 'HR Executive')
    assert.equal(items.at(-1).count, 0)
  })

  test('does not pad with curated entries when live data already fills the limit', () => {
    const items = buildSuggestions({ liveRows, curatedValues: ['HR Executive'], query: '', limit: 2 })
    assert.equal(items.length, 2)
    assert.ok(items.every((i) => i.source === 'live'))
  })

  test('ranks exact match first, then starts-with, then contains, when a query is present', () => {
    const rows = [
      { value: 'Senior React Developer', count: 5 },
      { value: 'React Developer', count: 12 },
    ]
    const items = buildSuggestions({ liveRows: rows, query: 'React Developer', limit: 10 })
    assert.equal(items[0].value, 'React Developer')
  })

  test('a curated value can surface at zero live count if it matches the query', () => {
    const items = buildSuggestions({ liveRows: [{ value: 'Bengaluru', count: 24 }], curatedValues: ['Kochi'], query: 'Ko', limit: 10 })
    assert.deepEqual(items, [{ value: 'Kochi', count: 0, source: 'curated' }])
  })

  test('a non-curated value with zero live count never appears at all', () => {
    // "Kochi" only exists as a query string here, never as a live row or a curated value.
    const items = buildSuggestions({ liveRows: [{ value: 'Bengaluru', count: 24 }], curatedValues: [], query: 'Kochi', limit: 10 })
    assert.deepEqual(items, [])
  })

  test('respects the limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ value: `City ${i}`, count: i }))
    assert.equal(buildSuggestions({ liveRows: many, query: '', limit: MAX_SUGGESTIONS }).length, MAX_SUGGESTIONS)
  })
})

describe('buildGroupedSuggestions', () => {
  const titles = { live: [{ value: 'Frontend Developer', count: 18 }], curated: [] }
  const skills = { live: [{ value: 'React', count: 12 }], curated: [] }
  const companies = { live: [{ value: 'Solace Technologies', count: 4, id: 'c1' }], curated: [] }

  test('orders titles before skills before companies', () => {
    const items = buildGroupedSuggestions({ titles, skills, companies, query: '', limit: 15 })
    assert.deepEqual(
      items.map((i) => i.kind),
      ['title', 'skill', 'company']
    )
  })

  test('tags each item with its kind and preserves extra fields like a company id', () => {
    const items = buildGroupedSuggestions({ titles, skills, companies, query: '', limit: 15 })
    const company = items.find((i) => i.kind === 'company')
    assert.equal(company.value, 'Solace Technologies')
    assert.equal(company.id, 'c1')
  })

  test('caps the combined list, not each group individually', () => {
    const items = buildGroupedSuggestions({ titles, skills, companies, query: '', limit: 2 })
    assert.equal(items.length, 2)
    assert.deepEqual(
      items.map((i) => i.kind),
      ['title', 'skill']
    )
  })

  test('a query only surfaces groups with a matching row', () => {
    const items = buildGroupedSuggestions({ titles, skills, companies, query: 'react', limit: 15 })
    assert.deepEqual(
      items.map((i) => i.value),
      ['React']
    )
  })
})
