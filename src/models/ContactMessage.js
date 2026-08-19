import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const contactMessageSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    role: { type: String, enum: ['Job Seeker', 'Employer', 'Other'], default: 'Other' },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    status: { type: String, enum: ['new', 'read', 'resolved'], default: 'new' },
  },
  { timestamps: true }
)

applyIdTransform(contactMessageSchema)

export default model('ContactMessage', contactMessageSchema)
