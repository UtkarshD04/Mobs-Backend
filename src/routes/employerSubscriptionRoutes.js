import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { paymentLimiter } from '../middleware/rateLimit.js'
import {
  getSubscription,
  getAccessStatus,
  createSubscriptionOrder,
  verifySubscriptionPayment,
  confirmMockSubscriptionPayment,
} from '../controllers/employerSubscriptionController.js'

const router = Router()

router.use(requireAuth)

router.get('/', getSubscription)
router.get('/access-status', getAccessStatus)
router.post('/order', paymentLimiter, createSubscriptionOrder)
router.post('/verify-payment', paymentLimiter, verifySubscriptionPayment)
router.post('/mock-confirm', paymentLimiter, confirmMockSubscriptionPayment)

export default router
