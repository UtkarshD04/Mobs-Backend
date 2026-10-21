// Short-lived in-process cache for anonymous, read-only endpoints that run heavy
// aggregations on every landing-page view. Also sets Cache-Control so browsers and the
// reverse proxy / CDN absorb repeat hits before they reach any instance. Per-process, so
// data can be up to `ttlSeconds` stale — only use it where that is fine.
const MAX_ENTRIES = 500

export function responseCache(ttlSeconds) {
  const store = new Map()
  return (req, res, next) => {
    if (req.method !== 'GET') return next()
    res.set('Cache-Control', `public, max-age=${ttlSeconds}`)
    const key = req.originalUrl
    const hit = store.get(key)
    if (hit && hit.expires > Date.now()) {
      res.set('X-Cache', 'HIT')
      return res.status(200).type('application/json').send(hit.body)
    }
    const json = res.json.bind(res)
    res.json = (body) => {
      if (res.statusCode === 200) {
        if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value)
        store.set(key, { body: JSON.stringify(body), expires: Date.now() + ttlSeconds * 1000 })
      } else {
        res.removeHeader('Cache-Control')
      }
      return json(body)
    }
    next()
  }
}
