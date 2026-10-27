import { Router } from 'express'
import { requirePermission } from '../middleware/requirePermission.js'
import { requireAuth } from '../middleware/auth.js'
import { requireActiveSubscription } from '../middleware/requireActiveSubscription.js'
import { paymentLimiter } from '../middleware/rateLimit.js'
import {
  listJobs,
  jobLocationFacets,
  jobHiringPincodes,
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
import { getJobInsights } from '../controllers/jobInsightsController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listJobs)
router.get('/location-facets', jobLocationFacets)
router.get('/hiring-pincodes', jobHiringPincodes)
// Creating and publishing both require an active employer plan — read-only
// access to jobs already posted stays available regardless of subscription
// state.
router.post('/', requirePermission('jobs.manage'), requireActiveSubscription, createJob)
router.get('/:id', getJob)
router.get('/:id/insights', requirePermission('candidates.view'), getJobInsights)
router.put('/:id', requirePermission('jobs.manage'), updateJob)
router.patch('/:id/status', requirePermission('jobs.publish'), requireActiveSubscription, setJobStatus)
router.post('/:id/pay/order', requirePermission('jobs.publish'), paymentLimiter, createJobPaymentOrder)
router.post('/:id/pay/verify', requirePermission('jobs.publish'), paymentLimiter, verifyJobPayment)
router.post('/:id/pay/mock-confirm', requirePermission('jobs.publish'), paymentLimiter, confirmMockJobPayment)
router.post('/:id/duplicate', requirePermission('jobs.manage'), duplicateJob)
router.delete('/:id', requirePermission('jobs.manage'), deleteJob)

export default router
