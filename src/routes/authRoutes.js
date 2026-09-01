import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { authLimiter } from '../middleware/rateLimit.js'
import { login, signup, googleLogin, googleSignup, getMe, updateMe, forgotPassword, resetPassword } from '../controllers/authController.js'

const router = Router()

router.post('/login', authLimiter, login)
router.post('/signup', authLimiter, signup)
router.post('/google-login', authLimiter, googleLogin)
router.post('/google-signup', authLimiter, googleSignup)
router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/reset-password', authLimiter, resetPassword)
router.get('/me', requireAuth, getMe)
router.put('/me', requireAuth, updateMe)

export default router
