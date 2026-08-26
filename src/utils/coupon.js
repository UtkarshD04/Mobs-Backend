import Coupon from '../models/Coupon.js'

// Thrown for any reason a coupon can't be applied — the message is safe to
// show directly to the payer, unlike a generic 500.
export class CouponError extends Error {}

export async function findApplicableCoupon(code, purpose, amount) {
  if (!code) return null

  const coupon = await Coupon.findOne({ code: String(code).trim().toUpperCase() })
  if (!coupon) throw new CouponError('Invalid coupon code')
  if (!coupon.isActive) throw new CouponError('This coupon is no longer active')
  if (coupon.appliesTo !== purpose) throw new CouponError('This coupon cannot be used for this payment')
  if (coupon.expiresAt && coupon.expiresAt < new Date()) throw new CouponError('This coupon has expired')
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    throw new CouponError('This coupon has reached its usage limit')
  }
  if (amount < coupon.minOrderAmount) {
    throw new CouponError(`This coupon requires a minimum amount of ₹${coupon.minOrderAmount}`)
  }

  return coupon
}

// Razorpay requires an order amount of at least ₹1, so the discount never
// wipes out the whole fee even for a 100%-off coupon.
export function computeDiscount(coupon, amount) {
  let discount = coupon.discountType === 'percentage' ? (amount * coupon.discountValue) / 100 : coupon.discountValue
  if (coupon.discountType === 'percentage' && coupon.maxDiscountAmount != null) {
    discount = Math.min(discount, coupon.maxDiscountAmount)
  }
  discount = Math.min(discount, amount - 1)
  return Math.max(0, Math.round(discount * 100) / 100)
}

export async function incrementCouponUsage(code) {
  if (!code) return
  await Coupon.updateOne({ code: String(code).trim().toUpperCase() }, { $inc: { usedCount: 1 } })
}
