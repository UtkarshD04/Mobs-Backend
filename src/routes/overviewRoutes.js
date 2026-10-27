import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getOverview } from '../controllers/overviewController.js'

const router = Router()

router.use(requireAuth)
router.get('/', getOverview)

export default router
