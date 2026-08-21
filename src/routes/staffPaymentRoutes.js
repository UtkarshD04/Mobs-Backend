import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listPayments, recordSubscriptionPayment } from '../controllers/staffPaymentController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listPayments)
router.patch('/subscriptions/:employeeId', recordSubscriptionPayment)

export default router
