import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listResumeQueue, stats, assign, bulkAssign, reviewResume } from '../controllers/staffResumeController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listResumeQueue)
router.get('/stats', stats)
// Literal '/assign' must be registered before the '/:employeeId' param route
// below, otherwise Express would match it as employeeId="assign".
router.patch('/assign', requireAdmin, bulkAssign)
router.patch('/:employeeId/assign', requireAdmin, assign)
router.patch('/:employeeId', reviewResume)

export default router
