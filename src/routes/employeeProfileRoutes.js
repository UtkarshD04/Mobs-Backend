import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { getProfile, updateProfile, deleteAccount } from '../controllers/employeeProfileController.js'

const router = Router()

router.get('/', requireEmployeeAuth, getProfile)
router.put('/', requireEmployeeAuth, updateProfile)
router.delete('/', requireEmployeeAuth, deleteAccount)

export default router
