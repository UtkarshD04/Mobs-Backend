import { monitorEventLoopDelay } from 'node:perf_hooks'
import { env } from '../config/env.js'

// Sheds load when this process is saturated: a 503 + Retry-After is cheap and lets the
// load balancer try another instance, instead of every request queueing behind a blocked
// event loop and timing out together. Health/readiness probes are never shed.
//
// The delay is always measured (it is cheap) so /ready can report it — that is how a load
// test tells a busy process apart from a slow network. Shedding itself stays opt-in.
// Each sample includes the sampling interval itself, so that is subtracted to leave the lag.
const RESOLUTION_MS = 20
const histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS })
histogram.enable()
let lastWindowP99Ms = 0
setInterval(() => {
  lastWindowP99Ms = Math.max(0, histogram.percentile(99) / 1e6 - RESOLUTION_MS)
  histogram.reset()
}, 5000).unref()

// p99 event-loop delay over roughly the last 5-10 seconds, in ms.
export function eventLoopLagMs() {
  return Math.max(lastWindowP99Ms, histogram.percentile(99) / 1e6 - RESOLUTION_MS, 0)
}

export function loadShed(req, res, next) {
  if (!(env.maxEventLoopLagMs > 0) || req.path === '/health' || req.path === '/ready') return next()
  if (eventLoopLagMs() > env.maxEventLoopLagMs) {
    res.set('Retry-After', '2')
    return res.status(503).json({ message: 'Server is busy. Please retry in a moment.' })
  }
  next()
}
