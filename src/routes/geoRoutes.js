import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { geoLimiter } from '../middleware/rateLimit.js'
import { listStates, places, reverse, pincode, cityPincodes } from '../controllers/geoController.js'

const router = Router()

router.use(requireAuth)

router.get('/states', listStates)
router.get('/places', geoLimiter, places)
router.get('/reverse', geoLimiter, reverse)
router.get('/pincode/:pin', geoLimiter, pincode)
router.get('/city-pincodes', geoLimiter, cityPincodes)

export default router
