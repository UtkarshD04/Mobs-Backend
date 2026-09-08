import { Router } from 'express'
import { redeemResumeAccess } from '../controllers/fileAccessController.js'

const router = Router()

router.get('/resume/:token', redeemResumeAccess)

export default router
