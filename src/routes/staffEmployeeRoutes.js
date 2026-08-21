import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { assignSkillTrack } from '../controllers/staffMockInterviewController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.patch('/:employeeId/skill-track', assignSkillTrack)

export default router
