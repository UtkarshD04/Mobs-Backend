import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const userSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: '' },
    // Optional: an invited team member has a roster row before they have
    // credentials (no invite-accept flow yet) — login rejects a missing hash.
    passwordHash: { type: String, required: false, select: false },
    // Set for accounts created/linked via "Continue with Google" — null for
    // password-only accounts. sparse so multiple null values don't collide
    // on the unique-ish lookup pattern.
    googleId: { type: String, default: null, index: true, sparse: true },
    role: { type: String, enum: ['Admin', 'Hiring Manager', 'Recruiter', 'Interviewer'], required: true },
    status: { type: String, enum: ['active', 'invited', 'disabled'], default: 'active' },
    lastActiveAt: { type: Date, default: null },
    resetPasswordToken: { type: String, default: null, select: false },
    resetPasswordExpires: { type: Date, default: null, select: false },

    pushTokens: { type: [String], default: [] },
    webPushSubscriptions: {
      type: [{ endpoint: String, keys: { p256dh: String, auth: String } }],
      default: [],
    },
  },
  { timestamps: true }
)

applyIdTransform(userSchema)

export default model('User', userSchema)
