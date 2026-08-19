import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listPublicJobs, getPublicJob } from '../controllers/employeePublicJobsController.js'

const router = Router()

router.get('/', requireEmployeeAuth, listPublicJobs)
router.get('/:id', requireEmployeeAuth, getPublicJob)

export default router
