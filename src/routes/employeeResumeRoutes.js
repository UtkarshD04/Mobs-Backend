import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { uploadResume } from '../middleware/upload.js'
import { getResume, uploadResumeFile } from '../controllers/employeeResumeController.js'

const router = Router()

router.get('/', requireEmployeeAuth, getResume)
router.post('/', requireEmployeeAuth, uploadResume, uploadResumeFile)

export default router
