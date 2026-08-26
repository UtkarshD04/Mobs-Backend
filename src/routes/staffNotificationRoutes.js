import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listNotifications, markAsRead, markAllRead, sendTestPush, listRecipients, sendNotification } from '../controllers/staffNotificationController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listNotifications)
router.get('/recipients', listRecipients)
router.post('/test-push', sendTestPush)
router.post('/send', sendNotification)
router.patch('/read-all', markAllRead)
router.patch('/:id/read', markAsRead)

export default router
