import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { assignSkillTrack } from '../controllers/staffMockInterviewController.js'

const router = Router()

// Any staff member (admin or HR) can assign a skill track after a mock
// interview — part of the resume-verification workflow, not admin-only.
router.use(requireStaffAuth)

router.patch('/:employeeId/skill-track', assignSkillTrack)

export default router
