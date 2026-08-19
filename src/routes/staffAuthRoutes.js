import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { authLimiter } from '../middleware/rateLimit.js'
import { login, getMe } from '../controllers/staffAuthController.js'

const router = Router()

router.post('/login', authLimiter, login)
router.get('/me', requireStaffAuth, getMe)

export default router
