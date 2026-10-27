import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { unlockLimiter, outreachLimiter } from '../middleware/rateLimit.js'
import { sendOutreach } from '../controllers/candidateOutreachController.js'
import { listCandidates, getCandidate, setCandidateStage, getCandidatePrivateDetails, getCandidateResumeUrl, unlockCandidate } from '../controllers/candidateController.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('candidates.view'), listCandidates)
router.get('/:id', requirePermission('candidates.view'), getCandidate)
router.get('/:id/private-details', requirePermission('cv.unlock', 'candidates.manage'), getCandidatePrivateDetails)
router.get('/:id/resume-url', requirePermission('candidates.view'), getCandidateResumeUrl)
router.post('/:id/unlock', requirePermission('cv.unlock'), unlockLimiter, unlockCandidate)
router.post('/:id/outreach', requirePermission('templates.manage'), outreachLimiter, sendOutreach)
router.patch('/:id/stage', requirePermission('candidates.manage'), setCandidateStage)

export default router
