import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listPayments, recordSubscriptionPayment, subscriptionTrend, employerRevenueTrend } from '../controllers/staffPaymentController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listPayments)
router.get('/subscriptions/trend', subscriptionTrend)
router.patch('/subscriptions/:employeeId', recordSubscriptionPayment)
router.get('/employer/trend', employerRevenueTrend)

export default router
