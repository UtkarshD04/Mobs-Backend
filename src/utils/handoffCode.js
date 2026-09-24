import crypto from 'crypto'
import { getRedisClient, isRedisConfigured } from '../config/redis.js'

const TTL_SECONDS = 60

// Single-instance fallback for when REDIS_URL isn't set — same "blank = no
// scale-out, but still correct" tradeoff rateLimit.js makes for its store.
// Codes never survive a restart either way, which is fine: they're only
// meant to live for the few hundred ms between the auth redirect firing and
// the dashboard loading.
const memoryStore = new Map()

function keyFor(type, code) {
  return `handoff:${type}:${code}`
}

// Mints a one-time code standing in for `userId` on the given audience
// (`employer` | `employee`) — handed to the dashboard app via `?code=`
// instead of the real JWT, so the long-lived token never touches the URL
// (browser history, server logs, Referer headers, analytics).
export async function issueHandoffCode(type, userId) {
  const code = crypto.randomBytes(32).toString('hex')
  const key = keyFor(type, code)
  const payload = JSON.stringify({ userId })

  if (isRedisConfigured()) {
    await getRedisClient().set(key, payload, 'EX', TTL_SECONDS)
  } else {
    const timer = setTimeout(() => memoryStore.delete(key), TTL_SECONDS * 1000)
    timer.unref?.()
    memoryStore.set(key, { payload, timer })
  }

  return code
}

// Atomically reads and deletes the code so it can be exchanged exactly once
// — a second attempt (retry, replay, someone who copied it off a shared
// screen) gets nothing back, even if it lands a few ms after the first.
export async function consumeHandoffCode(type, code) {
  const key = keyFor(type, code)

  if (isRedisConfigured()) {
    const raw = await getRedisClient().getdel(key)
    if (!raw) return null
    return JSON.parse(raw)
  }

  const entry = memoryStore.get(key)
  if (!entry) return null
  memoryStore.delete(key)
  clearTimeout(entry.timer)
  return JSON.parse(entry.payload)
}
