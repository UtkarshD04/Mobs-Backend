import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { authLimiter } from '../middleware/rateLimit.js'
import { login, getMe, forgotPassword, resetPassword } from '../controllers/staffAuthController.js'

const router = Router()

router.post('/login', authLimiter, login)
router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/reset-password', authLimiter, resetPassword)
router.get('/me', requireStaffAuth, getMe)

export default router
