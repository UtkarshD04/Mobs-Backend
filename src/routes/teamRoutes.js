import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requirePermission } from '../middleware/requirePermission.js'
import { listTeam, inviteMember, updateMemberRole, removeMember, getMe, getRoleMatrix, listAudit } from '../controllers/teamController.js'

const router = Router()

router.use(requireAuth)

router.get('/me', getMe)
router.get('/roles', getRoleMatrix)
router.get('/audit', requirePermission('audit.view'), listAudit)
router.get('/', listTeam)
router.post('/invite', requirePermission('team.manage'), inviteMember)
router.patch('/:id/role', requirePermission('team.manage'), updateMemberRole)
router.delete('/:id', requirePermission('team.manage'), removeMember)

export default router
