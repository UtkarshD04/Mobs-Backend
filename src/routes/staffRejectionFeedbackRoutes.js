import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { feedbackActionLimiter } from '../middleware/rateLimit.js'
import { listFeedback, feedbackCounts, feedbackFilters, getFeedback, reviewFeedback, addNote, retryNotification, resolveDispute } from '../controllers/staffRejectionFeedbackController.js'
import { listFollowUps, notifyEmployerFollowUp, recordContact, addFollowUpNote, setNextFollowUp, completeFollowUp } from '../controllers/staffFeedbackFollowUpController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listFeedback)
router.get('/counts', feedbackCounts)
router.get('/filters', feedbackFilters)

// Employer follow-ups. Registered before /:id so "follow-ups" is never read as a feedback id.
router.get('/follow-ups', listFollowUps)
router.post('/follow-ups/:id/notify', feedbackActionLimiter, notifyEmployerFollowUp)
router.post('/follow-ups/:id/contact', feedbackActionLimiter, recordContact)
router.post('/follow-ups/:id/notes', feedbackActionLimiter, addFollowUpNote)
router.patch('/follow-ups/:id/next', feedbackActionLimiter, setNextFollowUp)
router.post('/follow-ups/:id/complete', feedbackActionLimiter, completeFollowUp)

router.get('/:id', getFeedback)
router.post('/:id/review', feedbackActionLimiter, reviewFeedback)
router.post('/:id/notes', feedbackActionLimiter, addNote)
router.post('/:id/retry-notification', feedbackActionLimiter, retryNotification)
router.post('/:id/resolve-dispute', feedbackActionLimiter, resolveDispute)

export default router
