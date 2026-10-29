// Caches an async function's result per argument list for `ttlMs`, per process. Meant for
// heavy, visitor-independent reads (whole-collection aggregations behind the search-box
// autocomplete) that would otherwise run on every keystroke of every visitor.
//
// Callers that arrive while a lookup is still running share that one in-flight promise, so
// a burst of traffic right after expiry runs the query once instead of once per request.
// A failed lookup is dropped straight away, so the next call retries instead of serving
// the error for the whole TTL. Results are shared between callers: never mutate them.
const MAX_ENTRIES = 200

export function memoizeTtl(fn, ttlMs) {
  const cache = new Map()
  return (...args) => {
    const key = JSON.stringify(args)
    const hit = cache.get(key)
    if (hit && hit.expires > Date.now()) return hit.promise

    const promise = Promise.resolve().then(() => fn(...args))
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value)
    cache.set(key, { promise, expires: Date.now() + ttlMs })
    promise.catch(() => {
      if (cache.get(key)?.promise === promise) cache.delete(key)
    })
    return promise
  }
}
