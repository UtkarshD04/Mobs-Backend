import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listSubscriptionPayments } from '../controllers/employerSubscriptionController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listSubscriptionPayments)

export default router
