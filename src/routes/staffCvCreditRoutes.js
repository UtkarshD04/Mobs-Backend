import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import {
  listCreditPurchases,
  listCvUnlocks,
  listCreditLedger,
  creditSummary,
  adjustCredits,
  listPlansForAdmin,
  createPlan,
  updatePlan,
} from '../controllers/staffCvCreditController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/summary', creditSummary)
router.get('/purchases', listCreditPurchases)
router.get('/unlocks', listCvUnlocks)
router.get('/ledger', listCreditLedger)
router.post('/adjust', adjustCredits)
router.get('/plans', listPlansForAdmin)
router.post('/plans', createPlan)
router.patch('/plans/:id', updatePlan)

export default router
