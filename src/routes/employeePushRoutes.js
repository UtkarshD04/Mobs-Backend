import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { createPushHandlers } from '../controllers/pushController.js'

const router = Router()
const { registerExpoToken, subscribeWebPush, unsubscribeWebPush } = createPushHandlers((req) => req.employee)

router.use(requireEmployeeAuth)
router.post('/expo-token', registerExpoToken)
router.post('/subscribe', subscribeWebPush)
router.post('/unsubscribe', unsubscribeWebPush)

export default router
