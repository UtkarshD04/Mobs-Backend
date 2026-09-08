import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { uploadResume } from '../middleware/upload.js'
import { getResume, uploadResumeFile, deleteResume } from '../controllers/employeeResumeController.js'

const router = Router()

router.get('/', requireEmployeeAuth, getResume)
router.post('/', requireEmployeeAuth, uploadResume, uploadResumeFile)
router.delete('/', requireEmployeeAuth, deleteResume)

export default router
