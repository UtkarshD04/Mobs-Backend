import crypto from 'crypto'
import HandoffCode from '../models/HandoffCode.js'
import { getRedisClient, isRedisConfigured } from '../config/redis.js'

const TTL_SECONDS = 60

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
    // No Redis: Mongo (TTL-indexed) keeps this correct across instances/workers.
    await HandoffCode.create({ key, userId, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000) })
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

  // The TTL monitor only sweeps once a minute, so expiry is checked here too.
  const entry = await HandoffCode.findOneAndDelete({ key }).lean()
  if (!entry || entry.expiresAt < new Date()) return null
  return { userId: entry.userId }
}
