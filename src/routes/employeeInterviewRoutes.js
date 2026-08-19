import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listInterviews } from '../controllers/employeeInterviewController.js'

const router = Router()

router.get('/', requireEmployeeAuth, listInterviews)

export default router
