import { Router } from 'express'
import { redeemResumeAccess, redeemPhotoAccess } from '../controllers/fileAccessController.js'

const router = Router()

router.get('/resume/:token', redeemResumeAccess)
router.get('/photo/:token', redeemPhotoAccess)

export default router
