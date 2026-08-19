import { Router } from 'express'
import { requireStaffAuth } from '../middleware/staffAuth.js'
import { listTeam, createTeammate } from '../controllers/staffTeamController.js'

const router = Router()

router.use(requireStaffAuth)

router.get('/', listTeam)
router.post('/', createTeammate)

export default router
