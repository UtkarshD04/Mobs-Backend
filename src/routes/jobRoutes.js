import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requireActiveSubscription } from '../middleware/requireActiveSubscription.js'
import { paymentLimiter } from '../middleware/rateLimit.js'
import {
  listJobs,
  getJob,
  createJob,
  updateJob,
  setJobStatus,
  createJobPaymentOrder,
  verifyJobPayment,
  confirmMockJobPayment,
  duplicateJob,
  deleteJob,
} from '../controllers/jobController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listJobs)
// Creating and publishing both require an active employer plan — read-only
// access to jobs already posted stays available regardless of subscription
// state.
router.post('/', requireActiveSubscription, createJob)
router.get('/:id', getJob)
router.put('/:id', updateJob)
router.patch('/:id/status', requireActiveSubscription, setJobStatus)
router.post('/:id/pay/order', paymentLimiter, createJobPaymentOrder)
router.post('/:id/pay/verify', paymentLimiter, verifyJobPayment)
router.post('/:id/pay/mock-confirm', paymentLimiter, confirmMockJobPayment)
router.post('/:id/duplicate', duplicateJob)
router.delete('/:id', deleteJob)

export default router
