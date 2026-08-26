import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { submitEmployeeTicket, listMyTickets } from '../controllers/supportController.js'

const router = Router()

router.use(requireEmployeeAuth)

router.get('/tickets', listMyTickets)
router.post('/tickets', submitEmployeeTicket)

export default router
