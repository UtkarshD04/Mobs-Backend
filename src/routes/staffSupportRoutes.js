import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listTickets, respondTicket } from '../controllers/staffSupportController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listTickets)
router.patch('/:id', respondTicket)

export default router
