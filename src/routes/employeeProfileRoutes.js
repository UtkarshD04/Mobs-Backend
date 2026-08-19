import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { getProfile, updateProfile } from '../controllers/employeeProfileController.js'

const router = Router()

router.get('/', requireEmployeeAuth, getProfile)
router.put('/', requireEmployeeAuth, updateProfile)

export default router
