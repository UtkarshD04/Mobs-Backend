import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getCreditBalance, listCvCreditPayments } from '../controllers/employerCvCreditController.js'

const router = Router()

router.use(requireAuth)

router.get('/', getCreditBalance)
router.get('/purchases', listCvCreditPayments)

export default router
