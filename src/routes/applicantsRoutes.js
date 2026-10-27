import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requirePermission } from '../middleware/requirePermission.js'
import { listApplicants, applicantsSummary, getApplicant, moveApplicant, bulkUpdate, updateApplicant, addNote, rejectApplicant, rejectionOptions, compareApplicants, exportApplicants } from '../controllers/applicantsController.js'

const router = Router()

router.use(requireAuth)

// Reads are scoped inside the handlers (an Interviewer only ever gets candidates they interview).
router.get('/', listApplicants)
router.get('/summary', applicantsSummary)
router.get('/rejection-options', rejectionOptions)
router.get('/export', requirePermission('exports.run'), exportApplicants)
router.post('/compare', requirePermission('candidates.view'), compareApplicants)
router.post('/bulk', requirePermission('candidates.manage'), bulkUpdate)
router.get('/:id', getApplicant)
router.patch('/:id', requirePermission('candidates.manage'), updateApplicant)
router.post('/:id/notes', requirePermission('candidates.manage'), addNote)
router.post('/:id/stage', requirePermission('candidates.manage'), moveApplicant)
router.post('/:id/reject', requirePermission('candidates.reject'), rejectApplicant)

export default router
