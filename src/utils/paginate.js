const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

// Reads page/limit from a list request's query string, clamped to sane
// bounds so `?limit=999999` can't force an unbounded scan/serialize.
export function paginationParams(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(req.query.limit, 10) || DEFAULT_LIMIT))
  return { page, limit, skip: (page - 1) * limit }
}

// Existing frontends consume these list endpoints as bare arrays, so the
// response body stays a bare array (now capped in size) rather than an
// envelope — pagination metadata rides on headers instead, for any client
// that wants to page through further without a breaking response-shape change.
export function setPaginationHeaders(res, { page, limit, total }) {
  res.set('X-Total-Count', String(total))
  res.set('X-Page', String(page))
  res.set('X-Limit', String(limit))
}

export async function paginate(model, query, { page, limit, skip }, { sort, populate, select } = {}) {
  let find = model.find(query)
  if (select) find = find.select(select)
  if (populate) find = Array.isArray(populate) ? populate.reduce((q, p) => q.populate(p), find) : find.populate(populate)
  if (sort) find = find.sort(sort)

  const [data, total] = await Promise.all([find.skip(skip).limit(limit), model.countDocuments(query)])

  return { data, page, limit, total }
}
