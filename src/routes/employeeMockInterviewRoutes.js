import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { getMockInterview } from '../controllers/employeeMockInterviewController.js'

const router = Router()

router.get('/', requireEmployeeAuth, getMockInterview)

export default router
