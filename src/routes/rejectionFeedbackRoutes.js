import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listFeedback, getFeedbackForCandidate, resubmitFeedback, feedbackOptions } from '../controllers/rejectionFeedbackController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listFeedback)
router.get('/options', feedbackOptions)
router.get('/by-candidate/:candidateId', getFeedbackForCandidate)
router.put('/:id', resubmitFeedback)

export default router
