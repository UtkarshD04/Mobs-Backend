import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listApplications, exportApplications, updateApplication } from '../controllers/staffApplicationController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listApplications)
router.get('/export', exportApplications)
router.patch('/:id', updateApplication)

export default router
