// Pure ranking/blending helpers for GET /api/employee/jobs/suggestions.
// Kept DB-free so the ranking rules are unit-testable — see
// jobSuggestions.test.js. The controller supplies `liveRows` (grouped,
// counted values from candidate-visible jobs) and a curated fallback list.

export const MAX_SUGGESTIONS = 15

// 0 = exact match, 1 = starts-with, 2 = contains, null = no match.
export function matchRank(value, query) {
  if (!query) return 2
  const v = value.toLowerCase()
  const q = query.toLowerCase()
  if (v === q) return 0
  if (v.startsWith(q)) return 1
  if (v.includes(q)) return 2
  return null
}

// Merges live, counted rows with a curated list (deduped against anything
// already live), ranks against `query` (exact > starts-with > contains, tied
// broken by count desc), and caps to `limit`. With no query, sorts by count
// desc — since curated entries always carry count 0, they naturally sink to
// the bottom and only surface at all when live data doesn't fill `limit` on
// its own. A curated entry that matches the query still surfaces even at
// zero live count (labeled by the caller via `source: 'curated'`); a random
// zero-count value that isn't curated never appears, since only rows drawn
// from `liveRows` (count >= 1 by construction) or `curatedValues` exist in
// the pool at all.
export function buildSuggestions({ liveRows = [], curatedValues = [], query = '', limit = MAX_SUGGESTIONS }) {
  const liveByValueLower = new Set(liveRows.map((r) => r.value.toLowerCase()))
  const curatedOnly = curatedValues.filter((v) => !liveByValueLower.has(v.toLowerCase())).map((value) => ({ value, count: 0, source: 'curated' }))
  const pool = [...liveRows.map((r) => ({ ...r, source: 'live' })), ...curatedOnly]

  const trimmedQuery = query.trim()
  if (!trimmedQuery) return [...pool].sort((a, b) => b.count - a.count).slice(0, limit)

  return pool
    .map((row) => ({ row, rank: matchRank(row.value, trimmedQuery) }))
    .filter((r) => r.rank !== null)
    .sort((a, b) => a.rank - b.rank || b.row.count - a.row.count)
    .slice(0, limit)
    .map((r) => r.row)
}

// Combines the three pools behind GET /api/jobs/suggestions' "job title,
// skill or company" box into one ordered, capped list — titles first, then
// skills, then companies (each independently ranked by buildSuggestions
// above), tagged with `kind` so the caller can pick an icon and know what a
// selection means. Capping the *combined* list (not each group) means a
// group only shows up once the ones ahead of it run out of room, which is
// what "grouped in this order" means for a fixed-size dropdown.
export function buildGroupedSuggestions({ titles = {}, skills = {}, companies = {}, query = '', limit = MAX_SUGGESTIONS }) {
  const titleItems = buildSuggestions({ liveRows: titles.live, curatedValues: titles.curated, query, limit }).map((item) => ({ ...item, kind: 'title' }))
  const skillItems = buildSuggestions({ liveRows: skills.live, curatedValues: skills.curated, query, limit }).map((item) => ({ ...item, kind: 'skill' }))
  const companyItems = buildSuggestions({ liveRows: companies.live, curatedValues: companies.curated, query, limit }).map((item) => ({
    ...item,
    kind: 'company',
  }))
  return [...titleItems, ...skillItems, ...companyItems].slice(0, limit)
}
