import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { unlockLimiter } from '../middleware/rateLimit.js'
import { searchResumeDatabase, getResumeDatabaseCandidate, getResumeDatabaseResumeUrl, unlockResumeDatabaseCandidate } from '../controllers/employerResumeSearchController.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('candidates.view'), searchResumeDatabase)
router.get('/:employeeId', requirePermission('candidates.view'), getResumeDatabaseCandidate)
router.get('/:employeeId/resume-url', requirePermission('candidates.view'), getResumeDatabaseResumeUrl)
router.post('/:employeeId/unlock', requirePermission('cv.unlock'), unlockLimiter, unlockResumeDatabaseCandidate)

export default router
