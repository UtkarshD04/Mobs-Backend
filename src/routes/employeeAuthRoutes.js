import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { authLimiter, otpLimiter, emailOtpLimiter } from '../middleware/rateLimit.js'
import {
  login,
  phoneLogin,
  signup,
  googleLogin,
  googleSignup,
  getMe,
  updateMe,
  forgotPassword,
  resetPassword,
  sendPhoneOtp,
  sendEmailOtp,
  verifyEmailOtp,
  emailLogin,
  verifyPhoneOtp,
  verifyPhoneWidget,
  createHandoff,
  exchangeHandoff,
} from '../controllers/employeeAuthController.js'

const router = Router()

router.post('/send-otp', otpLimiter, sendPhoneOtp)
router.post('/verify-otp', otpLimiter, verifyPhoneOtp)
router.post('/verify-phone-widget', otpLimiter, verifyPhoneWidget)
router.post('/login', authLimiter, login)
router.post('/phone-login', authLimiter, phoneLogin)
router.post('/send-email-otp', emailOtpLimiter, sendEmailOtp)
router.post('/verify-email-otp', emailOtpLimiter, verifyEmailOtp)
router.post('/email-login', authLimiter, emailLogin)
router.post('/signup', authLimiter, signup)
router.post('/google-login', authLimiter, googleLogin)
router.post('/google-signup', authLimiter, googleSignup)
router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/reset-password', authLimiter, resetPassword)
router.post('/handoff', authLimiter, requireEmployeeAuth, createHandoff)
router.post('/exchange', authLimiter, exchangeHandoff)
router.get('/me', requireEmployeeAuth, getMe)
router.put('/me', requireEmployeeAuth, updateMe)

export default router
