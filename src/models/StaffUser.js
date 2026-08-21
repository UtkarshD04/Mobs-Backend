import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const staffUserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['Operations Manager', 'Resume Verification Lead', 'Interview Panel', 'Employer Success', 'Compliance & KYC'],
      required: true,
    },
    accessLevel: { type: String, enum: ['admin', 'staff'], default: 'staff' },
    status: { type: String, enum: ['active', 'invited', 'disabled'], default: 'active' },
    lastActiveAt: { type: Date, default: null },
    resetPasswordToken: { type: String, default: null, select: false },
    resetPasswordExpires: { type: Date, default: null, select: false },
  },
  { timestamps: true }
)

applyIdTransform(staffUserSchema)

export default model('StaffUser', staffUserSchema)
