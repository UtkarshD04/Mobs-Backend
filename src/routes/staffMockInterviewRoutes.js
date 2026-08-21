import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listMockInterviews, scheduleMockInterview, completeMockInterview, markNoShow } from '../controllers/staffMockInterviewController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listMockInterviews)
router.post('/', scheduleMockInterview)
router.patch('/:id/complete', completeMockInterview)
router.patch('/:id/no-show', markNoShow)

export default router
