import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { createPushHandlers } from '../controllers/pushController.js'

const router = Router()
const { registerExpoToken, subscribeWebPush, unsubscribeWebPush } = createPushHandlers((req) => req.staff)

router.use(requireStaffAuth)
router.post('/expo-token', registerExpoToken)
router.post('/subscribe', subscribeWebPush)
router.post('/unsubscribe', unsubscribeWebPush)

export default router
