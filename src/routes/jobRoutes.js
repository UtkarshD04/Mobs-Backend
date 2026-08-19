import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { paymentLimiter } from '../middleware/rateLimit.js'
import {
  listJobs,
  getJob,
  createJob,
  updateJob,
  setJobStatus,
  createJobPaymentOrder,
  verifyJobPayment,
  duplicateJob,
  deleteJob,
} from '../controllers/jobController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listJobs)
router.post('/', createJob)
router.get('/:id', getJob)
router.put('/:id', updateJob)
router.patch('/:id/status', setJobStatus)
router.post('/:id/pay/order', paymentLimiter, createJobPaymentOrder)
router.post('/:id/pay/verify', paymentLimiter, verifyJobPayment)
router.post('/:id/duplicate', duplicateJob)
router.delete('/:id', deleteJob)

export default router
