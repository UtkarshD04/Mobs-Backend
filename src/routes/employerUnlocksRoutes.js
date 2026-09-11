import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listUnlocks } from '../controllers/employerCvCreditController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listUnlocks)

export default router
