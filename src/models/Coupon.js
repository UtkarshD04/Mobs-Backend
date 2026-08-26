import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const couponSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    discountType: { type: String, enum: ['percentage', 'flat'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    // Only used when discountType is 'percentage' — caps the rupee amount knocked off a large order.
    maxDiscountAmount: { type: Number, default: null },
    minOrderAmount: { type: Number, default: 0 },
    // The only payable, fixed-price flow today — kept as an enum so a future
    // second payment surface (e.g. employer job fee) is an explicit addition.
    appliesTo: { type: String, enum: ['employee_subscription'], default: 'employee_subscription' },
    usageLimit: { type: Number, default: null }, // null = unlimited total redemptions
    usedCount: { type: Number, default: 0 },
    expiresAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'StaffUser', default: null },
  },
  { timestamps: true }
)

applyIdTransform(couponSchema, { createdBy: 'createdById' })

export default model('Coupon', couponSchema)
