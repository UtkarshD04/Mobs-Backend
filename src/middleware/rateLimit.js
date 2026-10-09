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

// Push-token registration has its own bucket (pushLimiter below) and is left out of this
// one: an app build that retried it in a loop used up the shared per-IP allowance and
// then every login from that network got "Too many requests".
const PUSH_PATH = /^\/employee\/push(\/|$)/

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  skip: (req) => PUSH_PATH.test(req.path),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
  store: makeStore('rl:api:'),
})

export const pushLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
  store: makeStore('rl:push:'),
})

// Email codes are already protected per address (30s between sends, 5 wrong guesses per
// code), so the per-IP cap here only has to stop bulk abuse.
export const emailOtpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many code requests. Please try again in a few minutes.' },
  store: makeStore('rl:email-otp:'),
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

// CV unlock spends a credit (real money, ₹25 each) — capped well above
// normal browsing use but tight enough to blunt a script trying to drain an
// employer's whole credit balance in a burst.
export const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many unlock requests. Please slow down and try again shortly.' },
  store: makeStore('rl:unlock:'),
})

// Recruiters emailing / texting candidates from the portal. A per-candidate
// daily cap lives in utils/outreach.js; this blunts bulk scripts on top of it.
export const outreachLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many messages sent. Please slow down and try again shortly.' },
  store: makeStore('rl:outreach:'),
})

// GSTIN verification — every attempt is a paid provider lookup. Keyed by
// company (the route sits behind requireAuth), so one company can't spend
// another's allowance and a company can't dodge it by switching networks.
export const gstVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `company:${req.company._id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Too many GSTIN verification attempts. Please try again in an hour.' },
  store: makeStore('rl:gst-verify:'),
})

// Each AI call costs money; this stops a script from running up the bill.
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many AI searches. Please slow down and try again shortly.' },
  store: makeStore('rl:ai:'),
})
