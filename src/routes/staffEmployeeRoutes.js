import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { assignSkillTrack, setTrustScore } from '../controllers/staffMockInterviewController.js'
import { listEmployees, createEmployee, setEmployeeStatus, deleteEmployee } from '../controllers/staffEmployeeAccountController.js'

const router = Router()

// Any staff member (admin or HR) can assign a skill track after a mock
// interview — part of the resume-verification workflow, not admin-only.
router.use(requireStaffAuth)

router.get('/', requireAdmin, listEmployees)
router.post('/', requireAdmin, createEmployee)
router.patch('/:employeeId/status', requireAdmin, setEmployeeStatus)
router.delete('/:employeeId', requireAdmin, deleteEmployee)
router.patch('/:employeeId/skill-track', assignSkillTrack)
router.patch('/:employeeId/trust-score', setTrustScore)

export default router
