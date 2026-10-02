import { Router } from 'express'
import { authLimiter } from '../middleware/rateLimit.js'
import { submitAssociate } from '../controllers/associateController.js'

const router = Router()

router.post('/', authLimiter, submitAssociate)

export default router
