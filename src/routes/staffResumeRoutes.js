import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listResumeQueue, reviewResume, assignResume, bulkAssignResumes } from '../controllers/staffResumeController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listResumeQueue)
// Literal '/assign' must be registered before the '/:employeeId' param route
// below, otherwise Express would match it as employeeId="assign".
router.patch('/assign', bulkAssignResumes)
router.patch('/:employeeId/assign', assignResume)
router.patch('/:employeeId', reviewResume)

export default router
