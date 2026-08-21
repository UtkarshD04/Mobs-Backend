import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listJobs, getJob, approveJob, recordJobPayment } from '../controllers/staffJobController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listJobs)
router.get('/:id', getJob)
router.patch('/:id/approve', approveJob)
router.patch('/:id/payment', recordJobPayment)

export default router
