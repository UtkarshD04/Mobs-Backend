import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Coupon from '../models/Coupon.js'

const DISCOUNT_TYPES = ['percentage', 'flat']

// Picks only the fields the client sent (so a PATCH can't accidentally wipe
// out unrelated ones) and coerces them to the right type. Throws on a bad
// value; required-field presence is only enforced when `partial` is false.
function normalizeCouponInput(body, { partial = false } = {}) {
  const out = {}

  if (body.code !== undefined) out.code = String(body.code).trim().toUpperCase()
  if (body.description !== undefined) out.description = String(body.description ?? '')
  if (body.discountType !== undefined) out.discountType = body.discountType
  if (body.discountValue !== undefined) out.discountValue = Number(body.discountValue)
  if (body.maxDiscountAmount !== undefined) {
    out.maxDiscountAmount = body.maxDiscountAmount === null || body.maxDiscountAmount === '' ? null : Number(body.maxDiscountAmount)
  }
  if (body.minOrderAmount !== undefined) out.minOrderAmount = Number(body.minOrderAmount) || 0
  if (body.usageLimit !== undefined) {
    out.usageLimit = body.usageLimit === null || body.usageLimit === '' ? null : Number(body.usageLimit)
  }
  if (body.expiresAt !== undefined) out.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
  if (body.isActive !== undefined) out.isActive = !!body.isActive

  if (!partial && !out.code) throw new Error('code is required')
  if (!partial && !DISCOUNT_TYPES.includes(out.discountType)) throw new Error('discountType must be percentage or flat')
  if (out.discountType !== undefined && !DISCOUNT_TYPES.includes(out.discountType)) throw new Error('discountType must be percentage or flat')
  if (!partial && (!Number.isFinite(out.discountValue) || out.discountValue <= 0)) {
    throw new Error('discountValue must be a positive number')
  }
  if (out.discountValue !== undefined && (!Number.isFinite(out.discountValue) || out.discountValue <= 0)) {
    throw new Error('discountValue must be a positive number')
  }
  if (out.maxDiscountAmount !== undefined && out.maxDiscountAmount !== null && out.maxDiscountAmount <= 0) {
    throw new Error('maxDiscountAmount must be a positive number')
  }
  if (out.usageLimit !== undefined && out.usageLimit !== null && out.usageLimit <= 0) {
    throw new Error('usageLimit must be a positive number')
  }
  if (out.expiresAt !== undefined && out.expiresAt !== null && Number.isNaN(out.expiresAt.getTime())) {
    throw new Error('expiresAt is not a valid date')
  }

  return out
}

export const listCoupons = asyncHandler(async (req, res) => {
  const { data, page, limit, total } = await paginate(Coupon, {}, paginationParams(req), { sort: { createdAt: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const createCoupon = asyncHandler(async (req, res) => {
  let input
  try {
    input = normalizeCouponInput(req.body ?? {})
  } catch (err) {
    return res.status(400).json({ message: err.message })
  }
  if (input.discountType === 'percentage' && input.discountValue > 100) {
    return res.status(400).json({ message: 'Percentage discount cannot exceed 100' })
  }

  const existing = await Coupon.findOne({ code: input.code })
  if (existing) return res.status(409).json({ message: 'A coupon with this code already exists' })

  const coupon = await Coupon.create({ ...input, createdBy: req.staff._id })
  await logStaffActivity(`${req.staff.name} created coupon ${coupon.code}`, 'green')

  res.status(201).json(coupon)
})

export const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id)
  if (!coupon) return res.status(404).json({ message: 'Coupon not found' })

  let input
  try {
    input = normalizeCouponInput(req.body ?? {}, { partial: true })
  } catch (err) {
    return res.status(400).json({ message: err.message })
  }

  const nextType = input.discountType ?? coupon.discountType
  const nextValue = input.discountValue ?? coupon.discountValue
  if (nextType === 'percentage' && nextValue > 100) {
    return res.status(400).json({ message: 'Percentage discount cannot exceed 100' })
  }

  if (input.code && input.code !== coupon.code) {
    const existing = await Coupon.findOne({ code: input.code, _id: { $ne: coupon._id } })
    if (existing) return res.status(409).json({ message: 'A coupon with this code already exists' })
  }

  Object.assign(coupon, input)
  await coupon.save()
  await logStaffActivity(`${req.staff.name} updated coupon ${coupon.code}`, 'navy')

  res.json(coupon)
})

export const deleteCoupon = asyncHandler(async (req, res) => {
  const coupon = await Coupon.findById(req.params.id)
  if (!coupon) return res.status(404).json({ message: 'Coupon not found' })
  if (coupon.usedCount > 0) {
    return res.status(409).json({ message: 'This coupon has already been redeemed — deactivate it instead of deleting' })
  }

  await coupon.deleteOne()
  await logStaffActivity(`${req.staff.name} deleted coupon ${coupon.code}`, 'red')

  res.json({ ok: true })
})
