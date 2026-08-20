import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listThreads, getThreadMessages, sendMessage } from '../controllers/employeeMessageController.js'

const router = Router()

router.use(requireEmployeeAuth)

router.get('/threads', listThreads)
router.get('/threads/:id/messages', getThreadMessages)
router.post('/threads/:id/messages', sendMessage)

export default router
