import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { staffListManaged, staffUpdateManaged, staffManagedCandidates } from '../controllers/managedShortlistController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)
router.get('/', staffListManaged)
router.get('/:id/candidates', staffManagedCandidates)
router.patch('/:id', staffUpdateManaged)

export default router
