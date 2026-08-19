import mongoose from 'mongoose'
import { logger } from './logger.js'

export async function connectDB(uri) {
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'))
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'))
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'))

  await mongoose.connect(uri, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  })
  logger.info('MongoDB connected')
}

export async function disconnectDB() {
  await mongoose.connection.close()
}
