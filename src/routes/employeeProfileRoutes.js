import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { getProfile, updateProfile, completeProfile, deleteAccount } from '../controllers/employeeProfileController.js'

const router = Router()

router.get('/', requireEmployeeAuth, getProfile)
router.put('/', requireEmployeeAuth, updateProfile)
router.post('/complete', requireEmployeeAuth, completeProfile)
router.delete('/', requireEmployeeAuth, deleteAccount)

export default router
