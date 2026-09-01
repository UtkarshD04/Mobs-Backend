import rateLimit from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { getRedisClient, isRedisConfigured } from '../config/redis.js'

// Shares one limit across every PM2 cluster worker / server instance once
// REDIS_URL is set. Falls back to express-rate-limit's own in-memory store
// (correct for a single instance) when it isn't — same "blank = no-op"
// pattern as SMTP/VAPID in env.js.
function makeStore(prefix) {
  if (!isRedisConfigured()) return undefined
  const client = getRedisClient()
  return new RedisStore({
    prefix,
    sendCommand: (...args) => client.call(...args),
  })
}

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
  store: makeStore('rl:auth:'),
})

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
  store: makeStore('rl:api:'),
})

// Order creation/verification are cheap to spam and directly touch money —
// capped tighter than the general API limit.
export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many payment attempts. Please try again later.' },
  store: makeStore('rl:payment:'),
})
