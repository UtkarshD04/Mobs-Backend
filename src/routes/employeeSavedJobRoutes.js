import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listSavedJobs, saveJob, unsaveJob } from '../controllers/employeeSavedJobsController.js'

const router = Router()

router.use(requireEmployeeAuth)

router.get('/', listSavedJobs)
router.post('/', saveJob)
router.delete('/:jobId', unsaveJob)

export default router
