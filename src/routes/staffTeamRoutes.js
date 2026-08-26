import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listTeam, createTeammate, updateTeammate, resetTeammatePassword, deleteTeammate } from '../controllers/staffTeamController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listTeam)
router.post('/', createTeammate)
router.patch('/:id', updateTeammate)
router.post('/:id/reset-password', resetTeammatePassword)
router.delete('/:id', deleteTeammate)

export default router
