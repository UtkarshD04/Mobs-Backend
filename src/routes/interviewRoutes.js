import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listInterviews, scheduleInterview, rescheduleInterview, cancelInterview, submitFeedback } from '../controllers/interviewController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listInterviews)
router.post('/', scheduleInterview)
router.patch('/:id/reschedule', rescheduleInterview)
router.patch('/:id/cancel', cancelInterview)
router.post('/:id/feedback', submitFeedback)

export default router
