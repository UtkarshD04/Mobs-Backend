import { Router } from 'express'
import { authLimiter } from '../middleware/rateLimit.js'
import { deleteByPhone } from '../controllers/accountDeletionController.js'

const router = Router()

router.post('/', authLimiter, deleteByPhone)

export default router
