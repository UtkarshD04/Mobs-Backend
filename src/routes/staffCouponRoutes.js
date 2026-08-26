import { Router } from 'express'
import { requireStaffAuth, requireAdmin } from '../middleware/staffAuth.js'
import { listCoupons, createCoupon, updateCoupon, deleteCoupon } from '../controllers/staffCouponController.js'

const router = Router()

router.use(requireStaffAuth, requireAdmin)

router.get('/', listCoupons)
router.post('/', createCoupon)
router.patch('/:id', updateCoupon)
router.delete('/:id', deleteCoupon)

export default router
