import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listNotifications, markAsRead, markAllRead } from '../controllers/employeeNotificationController.js'

const router = Router()

router.use(requireEmployeeAuth)

router.get('/', listNotifications)
router.patch('/read-all', markAllRead)
router.patch('/:id/read', markAsRead)

export default router
