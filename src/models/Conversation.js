import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const conversationSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    contactName: { type: String, required: true },
    contactRole: { type: String, required: true },
    contactInitials: { type: String, required: true },
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

applyIdTransform(conversationSchema)

export default model('Conversation', conversationSchema)
