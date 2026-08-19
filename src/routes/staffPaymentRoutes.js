import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listPayments, recordSubscriptionPayment } from '../controllers/staffPaymentController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listPayments)
router.patch('/subscriptions/:employeeId', recordSubscriptionPayment)

export default router
