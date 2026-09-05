import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listJobs, getJob, createJob, approveJob, recordJobPayment, notifyHr } from '../controllers/staffJobController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listJobs)
router.post('/', createJob)
router.get('/:id', getJob)
router.patch('/:id/approve', approveJob)
router.patch('/:id/payment', recordJobPayment)
router.post('/:id/notify-hr', notifyHr)

export default router
