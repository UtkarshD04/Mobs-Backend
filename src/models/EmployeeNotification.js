import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const employeeNotificationSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    category: { type: String, enum: ['applications', 'resume', 'interviews', 'training', 'track', 'system'], required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    unread: { type: Boolean, default: true },
  },
  { timestamps: true }
)

applyIdTransform(employeeNotificationSchema)

export default model('EmployeeNotification', employeeNotificationSchema)
