import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listNotifications, markAsRead, markAllRead, sendTestPush, sendToCandidates } from '../controllers/notificationController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listNotifications)
router.post('/test-push', sendTestPush)
router.post('/send', sendToCandidates)
router.patch('/read-all', markAllRead)
router.patch('/:id/read', markAsRead)

export default router
