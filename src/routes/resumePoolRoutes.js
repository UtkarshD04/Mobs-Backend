import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { uploadResumePool } from '../middleware/resumePoolUpload.js'
import { bulkUpload, list, stats, assign, bulkAssign, review } from '../controllers/resumePoolController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', list)
router.get('/stats', stats)
router.post('/bulk-upload', requireAdmin, uploadResumePool, bulkUpload)
router.patch('/assign', requireAdmin, bulkAssign)
router.patch('/:id/assign', requireAdmin, assign)
router.patch('/:id/review', review)

export default router
