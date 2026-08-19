import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listResumeQueue, reviewResume } from '../controllers/staffResumeController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listResumeQueue)
router.patch('/:employeeId', reviewResume)

export default router
