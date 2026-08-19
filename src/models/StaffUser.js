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
    status: { type: String, enum: ['active', 'invited'], default: 'active' },
    lastActiveAt: { type: Date, default: null },
  },
  { timestamps: true }
)

applyIdTransform(staffUserSchema)

export default model('StaffUser', staffUserSchema)
