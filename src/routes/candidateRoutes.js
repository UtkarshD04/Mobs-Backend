import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { unlockLimiter } from '../middleware/rateLimit.js'
import { listCandidates, getCandidate, setCandidateStage, getCandidatePrivateDetails, getCandidateResumeUrl, unlockCandidate } from '../controllers/candidateController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listCandidates)
router.get('/:id', getCandidate)
router.get('/:id/private-details', getCandidatePrivateDetails)
router.get('/:id/resume-url', getCandidateResumeUrl)
router.post('/:id/unlock', unlockLimiter, unlockCandidate)
router.patch('/:id/stage', setCandidateStage)

export default router
