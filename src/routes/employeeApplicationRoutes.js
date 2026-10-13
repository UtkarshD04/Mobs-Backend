import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listApplications, applyToJob, withdrawApplication } from '../controllers/employeeApplicationController.js'
import { candidateFeedbackLimiter } from '../middleware/rateLimit.js'
import { getFeedback, disputeFeedback, askAboutFeedback } from '../controllers/employeeFeedbackController.js'

const router = Router()

router.get('/', requireEmployeeAuth, listApplications)
router.post('/', requireEmployeeAuth, applyToJob)
router.patch('/:id/withdraw', requireEmployeeAuth, withdrawApplication)
router.get('/:id/feedback', requireEmployeeAuth, getFeedback)
router.post('/:id/feedback/dispute', requireEmployeeAuth, candidateFeedbackLimiter, disputeFeedback)
router.post('/:id/feedback/question', requireEmployeeAuth, candidateFeedbackLimiter, askAboutFeedback)

export default router
