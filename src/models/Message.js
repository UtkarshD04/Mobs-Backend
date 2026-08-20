import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const messageSchema = new Schema(
  {
    conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    direction: { type: String, enum: ['in', 'out'], required: true },
    text: { type: String, required: true },
    read: { type: Boolean, default: true },
  },
  { timestamps: true }
)

applyIdTransform(messageSchema)

export default model('Message', messageSchema)
