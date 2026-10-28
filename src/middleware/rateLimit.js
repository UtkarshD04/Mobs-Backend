import rateLimit from 'express-rate-limit'
import { RedisStore } from 'rate-limit-redis'
import { getRedisClient, isRedisConfigured } from '../config/redis.js'

// Shares one limit across every PM2 cluster worker / server instance once
// REDIS_URL is set. Falls back to express-rate-limit's own in-memory store
// (correct for a single instance) when it isn't — same "blank = no-op"
// pattern as SMTP/VAPID in env.js.
// Shared by every limiter. passOnStoreError: if Redis hiccups, let the request through
// instead of turning a cache outage into a full API outage.
const base = { standardHeaders: true, legacyHeaders: false, passOnStoreError: true }

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
  ...base,
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
  ...base,
  message: { message: 'Too many requests. Please slow down.' },
  store: makeStore('rl:api:'),
})

export const pushLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  ...base,
  message: { message: 'Too many requests. Please slow down.' },
  store: makeStore('rl:push:'),
})

// Email codes are already protected per address (30s between sends, 5 wrong guesses per
// code), so the per-IP cap here only has to stop bulk abuse.
export const emailOtpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  ...base,
  message: { message: 'Too many code requests. Please try again in a few minutes.' },
  store: makeStore('rl:email-otp:'),
})

// Mobile OTP send/verify (and the website widget's token check). Per IP, to stop a script
// guessing codes or burning SMS credits; loose enough for many users behind one carrier NAT.
export const phoneOtpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  ...base,
  message: { message: 'Too many OTP requests. Please try again in a few minutes.' },
  store: makeStore('rl:phone-otp:'),
})

// Every send is a paid SMS — capped per number too, so rotating IPs can't flood one phone.
export const phoneOtpSendLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: (req) => `phone:${typeof req.body?.phone === 'string' ? req.body.phone.trim() : ''}`,
  ...base,
  message: { message: 'Too many OTPs sent to this number. Please try again in 15 minutes.' },
  store: makeStore('rl:phone-otp-send:'),
})

// Order creation/verification are cheap to spam and directly touch money —
// capped tighter than the general API limit.
export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  ...base,
  message: { message: 'Too many payment attempts. Please try again later.' },
  store: makeStore('rl:payment:'),
})

// CV unlock spends a credit (real money, ₹25 each) — capped well above
// normal browsing use but tight enough to blunt a script trying to drain an
// employer's whole credit balance in a burst.
export const unlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  ...base,
  message: { message: 'Too many unlock requests. Please slow down and try again shortly.' },
  store: makeStore('rl:unlock:'),
})

// Recruiters emailing / texting candidates from the portal. A per-candidate
// daily cap lives in utils/outreach.js; this blunts bulk scripts on top of it.
export const outreachLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  ...base,
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
  ...base,
  message: { code: 'RATE_LIMITED', message: 'Too many GSTIN verification attempts. Please try again in an hour.' },
  store: makeStore('rl:gst-verify:'),
})

// Signup-form GST pre-check — also a paid provider lookup, but with no
// company yet, so it is keyed by client IP.
export const gstSignupCheckLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  ...base,
  message: { code: 'RATE_LIMITED', message: 'Too many GSTIN checks. Please try again in an hour.' },
  store: makeStore('rl:gst-signup-check:'),
})

// Each AI call costs money; this stops a script from running up the bill.
export const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  ...base,
  message: { message: 'Too many AI searches. Please slow down and try again shortly.' },
  store: makeStore('rl:ai:'),
})

// Reviewer actions on rejection feedback and follow-ups (approve, return, notify, retry...). Generous for a
// working queue, but low enough to stop a runaway script or a stuck retry loop from spamming employers.
export const feedbackActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  ...base,
  message: { message: 'Too many actions. Please slow down.' },
  store: makeStore('rl:feedback-action:'),
})

// A candidate reporting or asking about feedback on their own applications.
export const candidateFeedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  ...base,
  message: { message: 'Too many requests. Please try again later.' },
  store: makeStore('rl:candidate-feedback:'),
})

// Location autocomplete proxies a third-party geocoder with its own usage policy —
// capped per IP so one dashboard can't burn the shared upstream quota.
export const geoLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many location searches. Please slow down.' },
  store: makeStore('rl:geo:'),
})
