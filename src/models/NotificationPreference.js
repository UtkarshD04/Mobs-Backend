import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// Mirrors EmployeeNotification's `category` enum. `email`/`sms` default to
// false — explicit, consent-based opt-in per category, matching the site's
// notification-preferences UX. `inApp` defaults to true (the in-app feed is
// the baseline experience, not an extra channel someone opts into).
const channelSchema = new Schema(
  {
    inApp: { type: Boolean, default: true },
    email: { type: Boolean, default: false },
    sms: { type: Boolean, default: false },
  },
  { _id: false }
)

const notificationPreferenceSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true },
    applications: { type: channelSchema, default: () => ({}) },
    resume: { type: channelSchema, default: () => ({}) },
    interviews: { type: channelSchema, default: () => ({}) },
    training: { type: channelSchema, default: () => ({}) },
    track: { type: channelSchema, default: () => ({}) },
    system: { type: channelSchema, default: () => ({}) },
  },
  { timestamps: true }
)

applyIdTransform(notificationPreferenceSchema, { employee: 'employeeId' })

export default model('NotificationPreference', notificationPreferenceSchema)
