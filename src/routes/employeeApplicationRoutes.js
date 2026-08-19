import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listApplications, applyToJob } from '../controllers/employeeApplicationController.js'

const router = Router()

router.get('/', requireEmployeeAuth, listApplications)
router.post('/', requireEmployeeAuth, applyToJob)

export default router
