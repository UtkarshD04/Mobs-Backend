import path from 'path'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import mongoSanitize from 'express-mongo-sanitize'
import pinoHttp from 'pino-http'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { apiLimiter } from './middleware/rateLimit.js'
import routes from './routes/index.js'
import { notFound } from './middleware/notFound.js'
import { errorHandler } from './middleware/errorHandler.js'
import { razorpayWebhook } from './controllers/paymentWebhookController.js'

export const app = express()

// Sits behind a reverse proxy/load balancer in any real deploy — needed for
// rate-limiting and logging to see the real client IP.
app.set('trust proxy', 1)

app.use(helmet())
app.use(compression())
app.use(cors({ origin: env.corsOrigin }))
app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }))

// Razorpay's webhook signature is computed over the exact raw request body,
// so this route must read it unparsed — it has to be wired up before the
// global express.json() below, which would otherwise consume the stream.
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), razorpayWebhook)

app.use(express.json({ limit: '1mb' }))
app.use(mongoSanitize())

app.get('/health', (req, res) => res.json({ status: 'ok' }))

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))
app.use('/api', apiLimiter, routes)

app.use(notFound)
app.use(errorHandler)
