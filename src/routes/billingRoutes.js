import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getBillingSummary, listInvoices } from '../controllers/billingController.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()

router.use(requireAuth)

router.get('/summary', requirePermission('billing.view'), getBillingSummary)
router.get('/invoices', requirePermission('billing.view'), listInvoices)

export default router
