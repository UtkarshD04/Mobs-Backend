import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const staffNotificationSchema = new Schema(
  {
    staff: { type: Schema.Types.ObjectId, ref: 'StaffUser', required: true, index: true },
    category: { type: String, enum: ['resumes', 'resume-pool', 'companies', 'payments', 'batches', 'interviews', 'requirements', 'system'], required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    unread: { type: Boolean, default: true },
  },
  { timestamps: true }
)

applyIdTransform(staffNotificationSchema)

export default model('StaffNotification', staffNotificationSchema)
