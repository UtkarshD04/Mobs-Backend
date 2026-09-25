import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listApplications, allyStats, updateApplication } from '../controllers/staffAllyController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listApplications)
router.get('/stats', allyStats)
router.patch('/:id', updateApplication)

export default router
