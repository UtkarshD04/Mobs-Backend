import { Router } from 'express'
import { apiLimiter } from '../middleware/rateLimit.js'
import { listFeaturedJobs } from '../controllers/publicJobsController.js'

const router = Router()

router.get('/featured', apiLimiter, listFeaturedJobs)

export default router
