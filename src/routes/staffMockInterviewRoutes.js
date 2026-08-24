import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listMockInterviews, scheduleMockInterview, completeMockInterview, markNoShow } from '../controllers/staffMockInterviewController.js'

const router = Router()

// Any staff member (admin or HR) can view and run mock interviews — this
// is part of the resume-verification workflow, not an admin-only function.
router.use(requireStaffAuth)

router.get('/', listMockInterviews)
router.post('/', scheduleMockInterview)
router.patch('/:id/complete', completeMockInterview)
router.patch('/:id/no-show', markNoShow)

export default router
