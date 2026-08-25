import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { createPushHandlers } from '../controllers/pushController.js'

const router = Router()
const { registerExpoToken, subscribeWebPush, unsubscribeWebPush } = createPushHandlers((req) => req.user)

router.use(requireAuth)
router.post('/expo-token', registerExpoToken)
router.post('/subscribe', subscribeWebPush)
router.post('/unsubscribe', unsubscribeWebPush)

export default router
