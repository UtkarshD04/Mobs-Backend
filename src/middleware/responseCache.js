// Short-lived in-process cache for anonymous, read-only endpoints that run heavy
// aggregations on every landing-page view. Also sets Cache-Control so browsers and the
// reverse proxy / CDN absorb repeat hits before they reach any instance. Per-process, so
// data can be up to `ttlSeconds` stale — only use it where that is fine.
//
// Only one request per URL ever runs the handler at a time. Without that, every request
// arriving in the moment an entry expires misses together and hits the database at once —
// under a few hundred requests a second that was dozens of identical queries per expiry,
// queued behind the connection pool for seconds. While one request refreshes, the others
// get the expired copy (X-Cache: STALE), or, when there is no copy yet, wait for that one
// request's result instead of running their own.
const MAX_ENTRIES = 500
// List endpoints carry their pagination on headers (utils/paginate.js), so a cached
// copy has to replay them too or a HIT would look like an unpaginated list.
const KEPT_HEADERS = ['X-Total-Count', 'X-Page', 'X-Limit']
// A refresh running longer than this is treated as stuck: callers stop waiting on it and
// the next request starts a new one.
const REFRESH_TIMEOUT_MS = 10 * 1000

function send(res, entry, cacheStatus) {
  if (res.headersSent) return
  res.set('X-Cache', cacheStatus)
  for (const [name, value] of entry.headers) res.set(name, value)
  res.status(200).type('application/json').send(entry.body)
}

export function responseCache(ttlSeconds) {
  const ttlMs = ttlSeconds * 1000
  // An expired copy keeps standing in during a refresh, but never once it is this old.
  const maxStaleMs = ttlMs * 10
  const store = new Map()
  const refreshing = new Map()

  return (req, res, next) => {
    if (req.method !== 'GET') return next()
    res.set('Cache-Control', `public, max-age=${ttlSeconds}`)
    const key = req.originalUrl
    const now = Date.now()
    const hit = store.get(key)
    if (hit && hit.expires > now) return send(res, hit, 'HIT')

    const pending = refreshing.get(key)
    if (pending && now - pending.startedAt < REFRESH_TIMEOUT_MS) {
      if (hit && now - hit.expires < maxStaleMs) return send(res, hit, 'STALE')
      const giveUp = new Promise((resolve) => setTimeout(resolve, REFRESH_TIMEOUT_MS - (now - pending.startedAt), null).unref())
      return Promise.race([pending.promise, giveUp]).then((entry) => (entry ? send(res, entry, 'HIT') : next()))
    }

    // This request refreshes the entry; settle() hands its result to everyone waiting.
    let settle
    const promise = new Promise((resolve) => {
      settle = resolve
    })
    refreshing.set(key, { promise, startedAt: now })
    const finish = (entry) => {
      if (refreshing.get(key)?.promise === promise) refreshing.delete(key)
      settle(entry)
    }

    const json = res.json.bind(res)
    res.json = (body) => {
      if (res.statusCode === 200) {
        const headers = KEPT_HEADERS.filter((name) => res.get(name) !== undefined).map((name) => [name, res.get(name)])
        const entry = { body: JSON.stringify(body), headers, expires: Date.now() + ttlMs }
        if (!store.has(key) && store.size >= MAX_ENTRIES) store.delete(store.keys().next().value)
        store.set(key, entry)
        finish(entry)
      } else {
        res.removeHeader('Cache-Control')
        finish(null)
      }
      return json(body)
    }
    // Ended without a JSON body (an error page, the client went away): let waiters move on.
    res.on('close', () => finish(null))
    next()
  }
}
