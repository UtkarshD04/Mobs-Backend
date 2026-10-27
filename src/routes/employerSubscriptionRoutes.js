import { Router } from 'express'
import { requirePermission } from '../middleware/requirePermission.js'
import { auditOnSuccess } from '../middleware/auditOnSuccess.js'
import { requireAuth } from '../middleware/auth.js'
import { paymentLimiter } from '../middleware/rateLimit.js'
import {
  getSubscription,
  getAccessStatus,
  previewSubscriptionCoupon,
  createSubscriptionOrder,
  verifySubscriptionPayment,
  confirmMockSubscriptionPayment,
} from '../controllers/employerSubscriptionController.js'

const router = Router()

router.use(requireAuth)

router.get('/', getSubscription)
router.get('/access-status', getAccessStatus)
router.post('/coupon/preview', requirePermission('billing.manage'), paymentLimiter, previewSubscriptionCoupon)
router.post('/order', requirePermission('billing.manage'), paymentLimiter, createSubscriptionOrder)
router.post('/verify-payment', requirePermission('billing.manage'), paymentLimiter, auditOnSuccess('billing.changed', 'Activated plan'), verifySubscriptionPayment)
router.post('/mock-confirm', requirePermission('billing.manage'), paymentLimiter, auditOnSuccess('billing.changed', 'Activated plan'), confirmMockSubscriptionPayment)

export default router
