import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listCandidates, getCandidate, setCandidateStage } from '../controllers/candidateController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listCandidates)
router.get('/:id', getCandidate)
router.patch('/:id/stage', setCandidateStage)

export default router
