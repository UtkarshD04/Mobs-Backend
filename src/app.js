import express from 'express'
import { authCookies } from './middleware/authCookie.js'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import mongoSanitize from 'express-mongo-sanitize'
import pinoHttp from 'pino-http'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import mongoose from 'mongoose'
import { lifecycle } from './config/lifecycle.js'
import { getRedisClient, isRedisConfigured } from './config/redis.js'
import { loadShed, eventLoopLagMs } from './middleware/loadShed.js'
import { apiLimiter } from './middleware/rateLimit.js'
import routes from './routes/index.js'
import fileAccessRoutes from './routes/fileAccessRoutes.js'
import { notFound } from './middleware/notFound.js'
import { errorHandler } from './middleware/errorHandler.js'
import { razorpayWebhook } from './controllers/paymentWebhookController.js'
import { googleMobileCallback } from './controllers/googleBridgeController.js'

export const app = express()

// Sits behind a reverse proxy/load balancer in any real deploy — needed for
// rate-limiting and logging to see the real client IP, and for
// `X-Forwarded-Proto` below to be trusted.
app.set('trust proxy', 1)

// INFRASTRUCTURE VERIFICATION REQUIRED: this repo cannot see the actual
// production reverse proxy/load balancer config, so it can't confirm HTTP
// is redirected to HTTPS there. This is a defense-in-depth backend guard,
// not a replacement for that check — see the deploy runbook for the exact
// verification commands to run against the production server.
//
// It only ever fires when the proxy explicitly reports (via
// X-Forwarded-Proto, trusted because of `trust proxy` above) that a request
// arrived over plain HTTP. A direct request to this process with no such
// header (e.g. an internal health check bypassing the proxy) is left alone,
// so this can't break anything that never went through the proxy. When the
// proxy already terminates TLS and forwards `X-Forwarded-Proto: https`
// (the expected setup), this is a permanent no-op.
if (env.isProduction) {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'http') {
      return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`)
    }
    next()
  })
}

// Lets you see which instance/worker answered (verify the load balancer is spreading traffic).
// Server-Timing is the time this process spent on the request, so a slow response can be
// split into "the server was slow" vs "the network / proxy / client was".
const instanceId = `${process.env.HOSTNAME ?? 'local'}:${process.pid}`
app.use((req, res, next) => {
  res.set('X-Instance', instanceId)
  const start = process.hrtime.bigint()
  const writeHead = res.writeHead
  res.writeHead = function (...args) {
    if (!res.headersSent) res.setHeader('Server-Timing', `app;dur=${(Number(process.hrtime.bigint() - start) / 1e6).toFixed(1)}`)
    return writeHead.apply(this, args)
  }
  next()
})

// Liveness + readiness are registered before everything else so probes stay cheap and
// are never rate-limited, logged or shed.
app.get('/health', (req, res) => res.json({ status: 'ok' }))
// Readiness: 503 while draining for shutdown or when a dependency is down, so the load
// balancer stops routing here without restarting a process that is merely waiting on Mongo.
app.get('/ready', async (req, res) => {
  if (lifecycle.draining) return res.status(503).json({ status: 'draining' })
  const checks = { mongo: mongoose.connection.readyState === 1 }
  if (isRedisConfigured()) {
    try {
      checks.redis = (await getRedisClient().ping()) === 'PONG'
    } catch {
      checks.redis = false
    }
  }
  const ready = Object.values(checks).every(Boolean)
  // eventLoopLagMs well above ~50 means this process is saturated (CPU-bound), not just busy.
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'degraded', checks, eventLoopLagMs: Math.round(eventLoopLagMs()) })
})

app.use(loadShed)
app.use(helmet())
app.use(compression())
// `exposedHeaders` is required for cross-origin callers (every frontend here
// runs on its own dev port, and each is a separate origin from the API) to
// read pagination metadata off the response at all — browsers hide any
// response header from JS by default unless it's explicitly exposed here.
// Non-sensitive metadata only; nothing else about the CORS policy changes.
app.use(cors({ origin: env.corsOrigin, credentials: true, exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Limit'] }))
// Default pino-http serializers dump the full req/res (headers included, so
// the Authorization bearer token would land in the terminal on every call) —
// pared down to just what's useful for a dev console.
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
    serializers: {
      req: (req) => ({ method: req.method, url: req.url }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  })
)

// Razorpay's webhook signature is computed over the exact raw request body,
// so this route must read it unparsed — it has to be wired up before the
// global express.json() below, which would otherwise consume the stream.
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), razorpayWebhook)


app.use(express.json({ limit: '1mb' }))
app.use(mongoSanitize())

app.get('/mobile/google-callback', googleMobileCallback)

// Every resume (S3-backed or a pre-migration legacy local file) is only
// ever reachable through /files — short-lived, token-gated (see
// fileAccessController.js). There is no unauthenticated static mount
// serving raw file paths.
//
// The staff frontends embed these in an inline resume-viewer iframe, which
// runs on a different origin from the API — override helmet's default
// X-Frame-Options/CSP frame-ancestors (SAMEORIGIN) that would otherwise
// block that, scoped to just our own known frontend origins.
app.use('/files', (_req, res, next) => {
  res.removeHeader('X-Frame-Options')
  res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${env.corsOrigin.join(' ')}`)
  next()
})
app.use('/files', apiLimiter, fileAccessRoutes)
app.use('/api', authCookies, apiLimiter, routes)

app.use(notFound)
app.use(errorHandler)
