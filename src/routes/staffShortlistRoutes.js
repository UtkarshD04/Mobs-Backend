import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listShortlist, transferToOperations, bulkTransferToOperations } from '../controllers/staffShortlistController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listShortlist)
router.patch('/transfer', bulkTransferToOperations)
router.patch('/:employeeId/transfer', transferToOperations)

export default router
