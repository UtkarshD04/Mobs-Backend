import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { authLimiter, otpLimiter } from '../middleware/rateLimit.js'
import {
  login,
  signup,
  googleLogin,
  googleSignup,
  getMe,
  updateMe,
  forgotPassword,
  resetPassword,
  sendPhoneOtp,
  verifyPhoneOtp,
  verifyPhoneWidget,
} from '../controllers/employeeAuthController.js'

const router = Router()

router.post('/send-otp', otpLimiter, sendPhoneOtp)
router.post('/verify-otp', otpLimiter, verifyPhoneOtp)
router.post('/verify-phone-widget', otpLimiter, verifyPhoneWidget)
router.post('/login', authLimiter, login)
router.post('/signup', authLimiter, signup)
router.post('/google-login', authLimiter, googleLogin)
router.post('/google-signup', authLimiter, googleSignup)
router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/reset-password', authLimiter, resetPassword)
router.get('/me', requireEmployeeAuth, getMe)
router.put('/me', requireEmployeeAuth, updateMe)

export default router
