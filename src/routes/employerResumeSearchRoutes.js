import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { unlockLimiter } from '../middleware/rateLimit.js'
import { searchResumeDatabase, getResumeDatabaseCandidate, getResumeDatabaseResumeUrl, unlockResumeDatabaseCandidate } from '../controllers/employerResumeSearchController.js'

const router = Router()

router.use(requireAuth)

router.get('/', searchResumeDatabase)
router.get('/:employeeId', getResumeDatabaseCandidate)
router.get('/:employeeId/resume-url', getResumeDatabaseResumeUrl)
router.post('/:employeeId/unlock', unlockLimiter, unlockResumeDatabaseCandidate)

export default router
