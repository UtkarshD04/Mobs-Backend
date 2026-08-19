import rateLimit from 'express-rate-limit'

// Per-instance in-memory store — correct for a single server instance.
// Swap in a Redis store (rate-limit-redis) once this runs behind more than
// one instance, or the limits stop meaning anything globally.

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again later.' },
})

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
})

// Order creation/verification are cheap to spam and directly touch money —
// capped tighter than the general API limit.
export const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many payment attempts. Please try again later.' },
})
