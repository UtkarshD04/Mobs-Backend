import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const staffActivitySchema = new Schema(
  {
    text: { type: String, required: true },
    tone: { type: String, enum: ['green', 'gold', 'navy'], default: 'navy' },
  },
  { timestamps: true }
)

applyIdTransform(staffActivitySchema)

export default model('StaffActivity', staffActivitySchema)
