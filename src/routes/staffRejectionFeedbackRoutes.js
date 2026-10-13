import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listFeedback, feedbackCounts, getFeedback, reviewFeedback, resolveDispute } from '../controllers/staffRejectionFeedbackController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listFeedback)
router.get('/counts', feedbackCounts)
router.get('/:id', getFeedback)
router.post('/:id/review', reviewFeedback)
router.post('/:id/resolve-dispute', resolveDispute)

export default router
