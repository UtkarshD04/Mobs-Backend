import { Router } from 'express'
import { authLimiter } from '../middleware/rateLimit.js'
import { submitCampusRequest } from '../controllers/campusRequestController.js'

const router = Router()

router.post('/', authLimiter, submitCampusRequest)

export default router
