import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listNotifications, markAsRead, markAllRead, sendTestPush } from '../controllers/staffNotificationController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listNotifications)
router.post('/test-push', sendTestPush)
router.patch('/read-all', markAllRead)
router.patch('/:id/read', markAsRead)

export default router
