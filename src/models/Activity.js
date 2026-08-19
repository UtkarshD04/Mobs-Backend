import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const activitySchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    text: { type: String, required: true },
    tone: { type: String, enum: ['green', 'gold', 'navy'], default: 'navy' },
  },
  { timestamps: true }
)

applyIdTransform(activitySchema)

export default model('Activity', activitySchema)
