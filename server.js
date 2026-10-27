import 'dotenv/config'
import cluster from 'node:cluster'
import os from 'node:os'
import { app } from './src/app.js'
import { connectDB, disconnectDB } from './src/config/db.js'
import { env } from './src/config/env.js'
import { logger } from './src/config/logger.js'
import { lifecycle } from './src/config/lifecycle.js'
import { isRedisConfigured } from './src/config/redis.js'
import { startInterviewReminderSweep } from './src/utils/interviewReminders.js'

let server

async function start() {
  await connectDB(env.mongoUri)
  server = app.listen(env.port, () => logger.info(`Backend listening on http://localhost:${env.port} (pid ${process.pid})`))
  // Must outlive the reverse proxy's idle timeout (see env.js); headersTimeout has to be larger still.
  server.keepAliveTimeout = env.keepAliveTimeoutMs
  server.headersTimeout = env.keepAliveTimeoutMs + 1000
  server.requestTimeout = env.requestTimeoutMs
  startInterviewReminderSweep()
}

// Drain: /ready flips to 503 so the load balancer stops sending new traffic, in-flight
// requests get SHUTDOWN_GRACE_MS to finish, then whatever is left is closed.
async function shutdown(signal) {
  if (lifecycle.draining) return
  lifecycle.draining = true
  logger.info(`${signal} received, draining`)
  const force = setTimeout(() => {
    logger.warn('Grace period over, closing remaining connections')
    server?.closeAllConnections()
  }, env.shutdownGraceMs)
  force.unref()
  if (server) {
    const closed = new Promise((resolve) => server.close(resolve))
    server.closeIdleConnections()
    // Keep-alive sockets that go idle mid-drain would otherwise hold close() open.
    const sweep = setInterval(() => server.closeIdleConnections(), 500)
    sweep.unref()
    await closed
    clearInterval(sweep)
  }
  await disconnectDB()
  logger.info('Shutdown complete')
  process.exit(0)
}

// Every route handler is wrapped in asyncHandler (Promise.resolve(fn()).catch(next)),
// so a rejection reaching here means it came from outside the request lifecycle
// (a timer, a stray callback, a third-party lib). Log it and keep serving other
// users instead of taking the whole process down for one stray bug.
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled promise rejection')
})

// An uncaught synchronous exception can leave the process in an undefined
// state, so this one still exits — but under PM2 (see ecosystem.config.cjs)
// that's a sub-second auto-restart, and cluster mode means the other workers
// keep serving requests while this one recovers.
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — exiting')
  process.exit(1)
})

// Optional built-in multi-core mode for plain `npm start` deploys (Docker/Nixpacks/Dokploy)
// where PM2 isn't in the picture: WEB_CONCURRENCY=4 (or "auto") forks that many workers
// sharing the port, with the kernel/primary round-robining connections between them.
// Unset (default) = single process, exactly as before. Don't combine with PM2 cluster mode.
function workerCount() {
  const raw = String(env.webConcurrency).trim().toLowerCase()
  if (!raw) return 1
  if (raw === 'auto') return os.availableParallelism()
  return Math.max(1, Math.floor(Number(raw)) || 1)
}

function runPrimary(count) {
  logger.info(`Primary ${process.pid} starting ${count} workers`)
  if (!isRedisConfigured()) {
    logger.warn('WEB_CONCURRENCY > 1 without REDIS_URL: rate limits are counted per worker, not shared. Set REDIS_URL.')
  }
  let stopping = false
  let recentCrashes = 0
  setInterval(() => (recentCrashes = 0), 60_000).unref()

  for (let i = 0; i < count; i += 1) cluster.fork()

  cluster.on('exit', (worker, code, signal) => {
    if (stopping) return
    recentCrashes += 1
    logger.error(`Worker ${worker.process.pid} died (${signal ?? code}), restarting`)
    // Backs off instead of hot-looping if the app can't boot (bad env, DB down).
    setTimeout(() => cluster.fork(), Math.min(recentCrashes * 500, 10_000))
  })

  const stop = (signal) => {
    stopping = true
    for (const worker of Object.values(cluster.workers)) worker.process.kill(signal)
    setTimeout(() => process.exit(0), env.shutdownGraceMs + 3000).unref()
    cluster.on('exit', () => {
      if (Object.keys(cluster.workers).length === 0) process.exit(0)
    })
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
}

const count = workerCount()
if (count > 1 && cluster.isPrimary) {
  runPrimary(count)
} else {
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  start().catch((err) => {
    logger.error({ err }, 'Failed to start server')
    process.exit(1)
  })
}
