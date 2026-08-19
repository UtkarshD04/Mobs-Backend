import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const notificationSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    category: { type: String, enum: ['batches', 'interviews', 'billing', 'jobs', 'candidates', 'offers', 'system'], required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    unread: { type: Boolean, default: true },
  },
  { timestamps: true }
)

applyIdTransform(notificationSchema)

export default model('Notification', notificationSchema)
