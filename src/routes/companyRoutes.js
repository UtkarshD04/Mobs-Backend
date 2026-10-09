import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { gstVerifyLimiter } from '../middleware/rateLimit.js'
import { getCompany, updateCompany, verifyGst } from '../controllers/companyController.js'

const router = Router()

router.use(requireAuth)

router.get('/', getCompany)
router.put('/', updateCompany)
router.post('/verify-gst', gstVerifyLimiter, verifyGst)

export default router
