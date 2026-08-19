import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listBatches, getBatch, listEligibleApplications, dispatchBatch } from '../controllers/staffBatchController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listBatches)
router.get('/:id', getBatch)
router.get('/:id/eligible-applications', listEligibleApplications)
router.patch('/:id/dispatch', dispatchBatch)

export default router
