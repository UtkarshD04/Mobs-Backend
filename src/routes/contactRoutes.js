import { Router } from 'express'
import { authLimiter } from '../middleware/rateLimit.js'
import { submitContactMessage } from '../controllers/contactController.js'

const router = Router()

router.post('/', authLimiter, submitContactMessage)

export default router
