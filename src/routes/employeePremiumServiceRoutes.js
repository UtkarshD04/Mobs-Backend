import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listMyServiceRequests, createServiceRequest, cancelMyServiceRequest } from '../controllers/premiumServiceController.js'

const router = Router()

router.use(requireEmployeeAuth)

router.get('/', listMyServiceRequests)
router.post('/', createServiceRequest)
router.patch('/:id/cancel', cancelMyServiceRequest)

export default router
