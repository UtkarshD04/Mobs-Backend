import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { submitTicket } from '../controllers/supportController.js'

const router = Router()

router.use(requireAuth)

router.post('/tickets', submitTicket)

export default router
