import 'dotenv/config'
import { app } from './src/app.js'
import { connectDB, disconnectDB } from './src/config/db.js'
import { env } from './src/config/env.js'
import { logger } from './src/config/logger.js'

let server

async function start() {
  await connectDB(env.mongoUri)
  server = app.listen(env.port, () => logger.info(`Backend listening on http://localhost:${env.port}`))
}

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`)
  if (server) {
    await new Promise((resolve) => server.close(resolve))
  }
  await disconnectDB()
  logger.info('Shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

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

start().catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})
