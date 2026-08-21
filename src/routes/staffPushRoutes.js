import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { createPushHandlers } from '../controllers/pushController.js'
import { asyncHandler } from '../utils/asyncHandler.js'
import { sendPush } from '../utils/push.js'

const router = Router()
const { registerExpoToken, subscribeWebPush, unsubscribeWebPush } = createPushHandlers((req) => req.staff)

router.use(requireStaffAuth)
router.post('/expo-token', registerExpoToken)
router.post('/subscribe', subscribeWebPush)
router.post('/unsubscribe', unsubscribeWebPush)

// Staff has no notification-inbox model to persist into (unlike Employee/
// Notification for employer) — this just proves the push pipeline works.
router.post(
  '/test',
  asyncHandler(async (req, res) => {
    await sendPush(req.staff, { title: 'Test notification', body: `Hey ${req.staff.name}, push notifications are working.` })
    res.status(204).end()
  })
)

export default router
