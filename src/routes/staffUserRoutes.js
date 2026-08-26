import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listUsers, createUser, setUserStatus, deleteUser } from '../controllers/staffUserController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listUsers)
router.post('/', createUser)
router.patch('/:id/status', setUserStatus)
router.delete('/:id', deleteUser)

export default router
