import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { getDashboard } from '../controllers/staffDashboardController.js'

const router = Router()

router.get('/', requireStaffAuth, getDashboard)

export default router
