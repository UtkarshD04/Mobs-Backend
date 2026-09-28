import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { aiLimiter } from '../middleware/rateLimit.js'
import { parseQuery } from '../controllers/aiController.js'

const router = Router()

router.use(requireAuth)
router.post('/parse-query', aiLimiter, parseQuery)

export default router
