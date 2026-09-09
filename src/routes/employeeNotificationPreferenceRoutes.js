import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { getPreferences, updatePreferences } from '../controllers/employeeNotificationPreferenceController.js'

const router = Router()

router.use(requireEmployeeAuth)

router.get('/', getPreferences)
router.put('/', updatePreferences)

export default router
