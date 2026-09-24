import { Schema, model } from 'mongoose'

// One pending email sign-in code per address. Only a keyed hash of the code is
// stored (see utils/emailOtp.js), and MongoDB's TTL index deletes the row once it
// expires, so nothing sensitive lingers.
const emailOtpSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
})

emailOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default model('EmailOtp', emailOtpSchema)
