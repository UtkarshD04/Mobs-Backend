import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listCampusRequests, campusRequestStats, updateCampusRequest } from '../controllers/staffCampusRequestController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listCampusRequests)
router.get('/stats', campusRequestStats)
router.patch('/:id', updateCampusRequest)

export default router
