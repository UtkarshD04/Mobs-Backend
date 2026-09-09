import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// A candidate's bookmark on a job — kept separate from `RecentlyViewedJob`
// (an implicit signal) since this one is an explicit user action.
const savedJobSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
  },
  { timestamps: true }
)

savedJobSchema.index({ employee: 1, job: 1 }, { unique: true })

applyIdTransform(savedJobSchema, { employee: 'employeeId', job: 'jobId' })

export default model('SavedJob', savedJobSchema)
