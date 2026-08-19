import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listTeam, inviteMember, updateMemberRole, removeMember } from '../controllers/teamController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listTeam)
router.post('/invite', inviteMember)
router.patch('/:id/role', updateMemberRole)
router.delete('/:id', removeMember)

export default router
