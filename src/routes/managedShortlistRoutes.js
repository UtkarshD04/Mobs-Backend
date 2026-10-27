import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requirePermission } from '../middleware/requirePermission.js'
import { listManagedRequests, createManagedRequest, closeManagedRequest } from '../controllers/managedShortlistController.js'

const router = Router()

router.use(requireAuth)
router.get('/', requirePermission('candidates.view'), listManagedRequests)
router.post('/', requirePermission('support.request'), createManagedRequest)
router.post('/:id/close', requirePermission('support.request'), closeManagedRequest)

export default router
