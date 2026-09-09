import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listRecentlyViewed, recordView } from '../controllers/employeeRecentlyViewedController.js'

const router = Router()

router.use(requireEmployeeAuth)

router.get('/', listRecentlyViewed)
router.post('/', recordView)

export default router
