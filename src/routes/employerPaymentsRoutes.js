import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { paymentLimiter } from '../middleware/rateLimit.js'
import { listSubscriptionPayments } from '../controllers/employerSubscriptionController.js'
import { createCvCreditOrder, verifyCvCreditPayment, confirmMockCvCreditPayment, previewCvCreditCoupon } from '../controllers/employerCvCreditController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listSubscriptionPayments)
// CV-credit purchases — separate purpose from the annual-plan payments
// above, sharing this /payments mount point per the credit-system API spec.
router.post('/coupon/preview', paymentLimiter, previewCvCreditCoupon)
router.post('/create-order', paymentLimiter, createCvCreditOrder)
router.post('/verify', paymentLimiter, verifyCvCreditPayment)
router.post('/mock-confirm', paymentLimiter, confirmMockCvCreditPayment)

export default router
