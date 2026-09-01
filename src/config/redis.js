import Redis from 'ioredis'
import { env } from './env.js'
import { logger } from './logger.js'

let client = null

export function isRedisConfigured() {
  return Boolean(env.redisUrl)
}

// Lazy singleton, same pattern as getRazorpayClient — only opens a
// connection if REDIS_URL is actually set, so a single-instance deploy
// without Redis keeps working off the in-memory rate-limit store.
export function getRedisClient() {
  if (!env.redisUrl) return null
  if (!client) {
    client = new Redis(env.redisUrl, {
      // Don't let a slow/unreachable Redis block server boot — connect lazily
      // and let express-rate-limit fail open on individual command errors.
      lazyConnect: false,
      maxRetriesPerRequest: 1,
    })
    client.on('error', (err) => logger.error({ err }, 'Redis connection error'))
    client.on('connect', () => logger.info('Redis connected'))
  }
  return client
}
