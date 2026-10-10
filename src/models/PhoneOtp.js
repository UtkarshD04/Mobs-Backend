import { Schema, model } from 'mongoose'

// One pending mobile OTP per number, for the SMS (Flow) API path in utils/msg91.js. Only a keyed
// hash of the code is stored (see utils/phoneOtp.js), and MongoDB's TTL index deletes the row once
// it expires, so nothing sensitive lingers.
const phoneOtpSchema = new Schema({
  phone: { type: String, required: true, unique: true, trim: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
})

phoneOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default model('PhoneOtp', phoneOtpSchema)
