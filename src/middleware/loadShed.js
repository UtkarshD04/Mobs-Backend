import { monitorEventLoopDelay } from 'node:perf_hooks'
import { env } from '../config/env.js'

// Sheds load when this process is saturated: a 503 + Retry-After is cheap and lets the
// load balancer try another instance, instead of every request queueing behind a blocked
// event loop and timing out together. Health/readiness probes are never shed.
const histogram = env.maxEventLoopLagMs > 0 ? monitorEventLoopDelay({ resolution: 20 }) : null
if (histogram) {
  histogram.enable()
  setInterval(() => histogram.reset(), 5000).unref()
}

export function loadShed(req, res, next) {
  if (!histogram || req.path === '/health' || req.path === '/ready') return next()
  const lagMs = histogram.percentile(99) / 1e6
  if (lagMs > env.maxEventLoopLagMs) {
    res.set('Retry-After', '2')
    return res.status(503).json({ message: 'Server is busy. Please retry in a moment.' })
  }
  next()
}
