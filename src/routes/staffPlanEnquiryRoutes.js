import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listPlanEnquiries, planEnquiryStats, updatePlanEnquiry } from '../controllers/staffPlanEnquiryController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listPlanEnquiries)
router.get('/stats', planEnquiryStats)
router.patch('/:id', updatePlanEnquiry)

export default router
