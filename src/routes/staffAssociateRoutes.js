import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listAssociates, associateStats, updateAssociate } from '../controllers/staffAssociateController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listAssociates)
router.get('/stats', associateStats)
router.patch('/:id', updateAssociate)

export default router
