import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { authLimiter, emailOtpLimiter, gstSignupCheckLimiter } from '../middleware/rateLimit.js'
import {
  login,
  signup,
  checkGst,
  googleLogin,
  googleSignup,
  getMe,
  updateMe,
  deleteMe,
  forgotPassword,
  resetPassword,
  verifyPhoneWidget,
  sendPhoneOtp,
  verifyPhoneOtp,
  phoneLogin,
  emailLogin,
  createHandoff,
  exchangeHandoff,
} from '../controllers/authController.js'
import { sendEmailOtp, verifyEmailOtp } from '../controllers/employeeAuthController.js'

import { logout } from '../middleware/authCookie.js'

const router = Router()

router.post('/verify-phone-widget', verifyPhoneWidget)
router.post('/send-otp', sendPhoneOtp)
router.post('/verify-otp', verifyPhoneOtp)
router.post('/phone-login', authLimiter, phoneLogin)
// Email codes are generic (address -> code -> emailToken), shared with the candidate flow.
router.post('/send-email-otp', emailOtpLimiter, sendEmailOtp)
router.post('/verify-email-otp', emailOtpLimiter, verifyEmailOtp)
router.post('/email-login', authLimiter, emailLogin)
router.post('/login', authLimiter, login)
router.post('/signup', authLimiter, signup)
router.post('/check-gst', gstSignupCheckLimiter, checkGst)
router.post('/google-login', authLimiter, googleLogin)
router.post('/google-signup', authLimiter, googleSignup)
router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/reset-password', authLimiter, resetPassword)
router.post('/handoff', authLimiter, requireAuth, createHandoff)
router.post('/exchange', authLimiter, exchangeHandoff)
router.get('/me', requireAuth, getMe)
router.put('/me', requireAuth, updateMe)
router.delete('/me', authLimiter, requireAuth, deleteMe)

router.post('/logout', logout('employer'))

export default router
