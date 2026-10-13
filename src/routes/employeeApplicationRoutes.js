import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listApplications, applyToJob, withdrawApplication } from '../controllers/employeeApplicationController.js'
import { getFeedback, disputeFeedback } from '../controllers/employeeFeedbackController.js'

const router = Router()

router.get('/', requireEmployeeAuth, listApplications)
router.post('/', requireEmployeeAuth, applyToJob)
router.patch('/:id/withdraw', requireEmployeeAuth, withdrawApplication)
router.get('/:id/feedback', requireEmployeeAuth, getFeedback)
router.post('/:id/feedback/dispute', requireEmployeeAuth, disputeFeedback)

export default router
