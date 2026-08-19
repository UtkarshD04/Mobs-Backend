import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listOffers, createOffer, updateOfferStatus } from '../controllers/offerController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listOffers)
router.post('/', createOffer)
router.patch('/:id/status', updateOfferStatus)

export default router
