import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listMockInterviews, scheduleMockInterview, completeMockInterview, markNoShow, mockInterviewStats } from '../controllers/staffMockInterviewController.js'

const router = Router()

// Any staff member (admin or HR) can view and run mock interviews — this
// is part of the resume-verification workflow, not an admin-only function.
router.use(requireStaffAuth)

// Literal '/stats' must be registered before the '/:id/...' param routes
// below, otherwise Express would try to match it as id="stats".
router.get('/stats', requireAdmin, mockInterviewStats)
router.get('/', listMockInterviews)
router.post('/', scheduleMockInterview)
router.patch('/:id/complete', completeMockInterview)
router.patch('/:id/no-show', markNoShow)

export default router
