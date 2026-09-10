import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listCandidates, getCandidate, setCandidateStage, getCandidatePrivateDetails, getCandidateResumeUrl } from '../controllers/candidateController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listCandidates)
router.get('/:id', getCandidate)
router.get('/:id/private-details', getCandidatePrivateDetails)
router.get('/:id/resume-url', getCandidateResumeUrl)
router.patch('/:id/stage', setCandidateStage)

export default router
