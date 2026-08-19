import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { assignSkillTrack } from '../controllers/staffMockInterviewController.js'

const router = Router()

router.use(requireStaffAuth)

router.patch('/:employeeId/skill-track', assignSkillTrack)

export default router
