import { logger } from '../config/logger.js'

const isProd = process.env.NODE_ENV === 'production'

export function errorHandler(err, req, res, next) {
  ;(req.log ?? logger).error({ err }, err.message)

  if (err.name === 'ValidationError') {
    return res.status(400).json({ message: err.message })
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid id' })
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: 'Already exists' })
  }

  const status = err.status ?? 500
  // Errors with an explicit status were thrown intentionally (validation,
  // auth, etc.) — their message is meant for the client. A bare 500 is an
  // unhandled/programmer error, so don't leak its message/shape in production.
  const message = status === 500 && isProd ? 'Something went wrong. Please try again.' : (err.message ?? 'Internal server error')
  res.status(status).json({ message })
}
