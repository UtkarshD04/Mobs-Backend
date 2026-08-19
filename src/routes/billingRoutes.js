import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getBillingSummary, listInvoices } from '../controllers/billingController.js'

const router = Router()

router.use(requireAuth)

router.get('/summary', getBillingSummary)
router.get('/invoices', listInvoices)

export default router
