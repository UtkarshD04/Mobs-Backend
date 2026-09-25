import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listApplications, dootStats, updateApplication } from '../controllers/staffDootController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listApplications)
router.get('/stats', dootStats)
router.patch('/:id', updateApplication)

export default router
