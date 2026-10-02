import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listServiceRequests, serviceRequestStats, updateServiceRequest } from '../controllers/premiumServiceController.js'

const router = Router()

// Any staff member (admin or HR) can work the Premium services queue.
router.use(requireStaffAuth)

// Literal '/stats' before the '/:id' param route.
router.get('/stats', serviceRequestStats)
router.get('/', listServiceRequests)
router.patch('/:id', updateServiceRequest)

export default router
