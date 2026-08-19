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

process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled promise rejection — exiting')
  process.exit(1)
})
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — exiting')
  process.exit(1)
})

start().catch((err) => {
  logger.error({ err }, 'Failed to start server')
  process.exit(1)
})
