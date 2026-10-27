import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requirePermission } from '../middleware/requirePermission.js'
import { listInterviews, scheduleInterview, rescheduleInterview, cancelInterview, submitFeedback, submitScorecard, updateInterviewPanel } from '../controllers/interviewController.js'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('candidates.view', 'candidates.viewAssigned'), listInterviews)
router.post('/', requirePermission('interviews.manage'), scheduleInterview)
router.patch('/:id/reschedule', requirePermission('interviews.manage'), rescheduleInterview)
router.patch('/:id/cancel', requirePermission('interviews.manage'), cancelInterview)
router.patch('/:id/panel', requirePermission('interviews.manage'), updateInterviewPanel)
router.post('/:id/feedback', requirePermission('interviews.manage'), submitFeedback)
router.post('/:id/scorecard', requirePermission('interviews.feedback'), submitScorecard)

export default router
