import { Router } from 'express'
import { authLimiter } from '../middleware/rateLimit.js'
import { submitApplication } from '../controllers/campusMantriController.js'

const router = Router()

router.post('/', authLimiter, submitApplication)

export default router
