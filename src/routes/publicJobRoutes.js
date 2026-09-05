import { Router } from 'express'
import { listLatestJobs } from '../controllers/publicJobsController.js'

const router = Router()

router.get('/', listLatestJobs)

export default router
