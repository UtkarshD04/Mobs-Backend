import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { paymentLimiter } from '../middleware/rateLimit.js'
import { listSubscriptionPayments } from '../controllers/employerSubscriptionController.js'
import { verifyAppleEmployerPurchase } from '../controllers/employerAppleController.js'
import { createCvCreditOrder, verifyCvCreditPayment, confirmMockCvCreditPayment, previewCvCreditCoupon } from '../controllers/employerCvCreditController.js'
import { requirePermission } from '../middleware/requirePermission.js'
import { auditOnSuccess } from '../middleware/auditOnSuccess.js'

const router = Router()

router.use(requireAuth)

router.get('/', listSubscriptionPayments)
// CV-credit purchases — separate purpose from the annual-plan payments
// above, sharing this /payments mount point per the credit-system API spec.
router.post('/coupon/preview', requirePermission('billing.manage'), paymentLimiter, previewCvCreditCoupon)
router.post('/create-order', requirePermission('billing.manage'), paymentLimiter, createCvCreditOrder)
router.post('/verify', requirePermission('billing.manage'), paymentLimiter, auditOnSuccess('billing.changed', 'Purchased CV credits'), verifyCvCreditPayment)
router.post('/mock-confirm', requirePermission('billing.manage'), paymentLimiter, auditOnSuccess('billing.changed', 'Purchased CV credits'), confirmMockCvCreditPayment)
// iOS in-app purchases (annual plans and CV-credit packs) — App Store rules require them there.
router.post('/apple', requirePermission('billing.manage'), paymentLimiter, auditOnSuccess('billing.changed', 'Apple in-app purchase'), verifyAppleEmployerPurchase)

export default router
