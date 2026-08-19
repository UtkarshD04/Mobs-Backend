import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getCompany, updateCompany } from '../controllers/companyController.js'

const router = Router()

router.use(requireAuth)

router.get('/', getCompany)
router.put('/', updateCompany)

export default router
