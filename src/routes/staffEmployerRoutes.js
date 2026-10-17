import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listEmployers } from '../controllers/staffEmployerController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listEmployers)

export default router
