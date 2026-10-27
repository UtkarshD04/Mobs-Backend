import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listOffers, createOffer, updateOfferStatus } from '../controllers/offerController.js'
import { requirePermission } from '../middleware/requirePermission.js'

const router = Router()

router.use(requireAuth)

router.get('/', requirePermission('candidates.view', 'offers.manage'), listOffers)
router.post('/', requirePermission('offers.manage'), createOffer)
router.patch('/:id/status', requirePermission('offers.manage'), updateOfferStatus)

export default router
