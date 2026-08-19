import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { paymentLimiter } from '../middleware/rateLimit.js'
import {
  getSubscription,
  createSubscriptionOrder,
  verifySubscriptionPayment,
  createGuestSubscriptionOrder,
  verifyGuestSubscriptionPayment,
  confirmMockSubscriptionPayment,
  confirmGuestMockSubscriptionPayment,
} from '../controllers/employeeSubscriptionController.js'

const router = Router()

router.get('/', requireEmployeeAuth, getSubscription)
router.post('/order', requireEmployeeAuth, paymentLimiter, createSubscriptionOrder)
router.post('/verify', requireEmployeeAuth, paymentLimiter, verifySubscriptionPayment)
router.post('/mock-confirm', requireEmployeeAuth, paymentLimiter, confirmMockSubscriptionPayment)

// Guest checkout — no account exists yet, used by the marketing site's
// "pay first, then create your account" signup flow.
router.post('/guest-order', paymentLimiter, createGuestSubscriptionOrder)
router.post('/guest-verify', paymentLimiter, verifyGuestSubscriptionPayment)
router.post('/guest-mock-confirm', paymentLimiter, confirmGuestMockSubscriptionPayment)

export default router
