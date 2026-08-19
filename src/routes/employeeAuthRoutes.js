import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { authLimiter } from '../middleware/rateLimit.js'
import { login, signup, getMe, updateMe, forgotPassword, resetPassword } from '../controllers/employeeAuthController.js'

const router = Router()

router.post('/login', authLimiter, login)
router.post('/signup', authLimiter, signup)
router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/reset-password', authLimiter, resetPassword)
router.get('/me', requireEmployeeAuth, getMe)
router.put('/me', requireEmployeeAuth, updateMe)

export default router
