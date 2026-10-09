import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { authLimiter, gstSignupCheckLimiter } from '../middleware/rateLimit.js'
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
  createHandoff,
  exchangeHandoff,
} from '../controllers/authController.js'

const router = Router()

router.post('/verify-phone-widget', verifyPhoneWidget)
router.post('/send-otp', sendPhoneOtp)
router.post('/verify-otp', verifyPhoneOtp)
router.post('/phone-login', authLimiter, phoneLogin)
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

export default router
