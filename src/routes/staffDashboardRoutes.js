import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { getDashboard } from '../controllers/staffDashboardController.js'

const router = Router()

router.get('/', requireStaffAuth, requireAdmin, getDashboard)

export default router
