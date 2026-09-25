import { Router } from 'express'
import { authLimiter } from '../middleware/rateLimit.js'
import { submitApplication } from '../controllers/dootController.js'

const router = Router()

router.post('/', authLimiter, submitApplication)

export default router
