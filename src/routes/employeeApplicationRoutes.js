import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listApplications, applyToJob, withdrawApplication } from '../controllers/employeeApplicationController.js'

const router = Router()

router.get('/', requireEmployeeAuth, listApplications)
router.post('/', requireEmployeeAuth, applyToJob)
router.patch('/:id/withdraw', requireEmployeeAuth, withdrawApplication)

export default router
