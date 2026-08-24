import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listResumeQueue, stats, assign, bulkAssign, reviewResume } from '../controllers/staffResumeController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listResumeQueue)
router.get('/stats', stats)
router.patch('/assign', requireAdmin, bulkAssign)
router.patch('/:employeeId/assign', requireAdmin, assign)
router.patch('/:employeeId', reviewResume)

export default router
