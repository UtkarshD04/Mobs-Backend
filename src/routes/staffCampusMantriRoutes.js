import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listApplications, campusMantriStats, updateApplication } from '../controllers/staffCampusMantriController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listApplications)
router.get('/stats', campusMantriStats)
router.patch('/:id', updateApplication)

export default router
