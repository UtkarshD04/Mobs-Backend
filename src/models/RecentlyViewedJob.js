import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// One row per (employee, job) pair, touched (not appended) on every view —
// `viewedOn` is what "recently viewed" sorts on, so a re-view just bumps the
// existing row back to the top instead of growing an unbounded log.
const recentlyViewedJobSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    viewedOn: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

recentlyViewedJobSchema.index({ employee: 1, job: 1 }, { unique: true })
recentlyViewedJobSchema.index({ employee: 1, viewedOn: -1 })

applyIdTransform(recentlyViewedJobSchema, { employee: 'employeeId', job: 'jobId' })

export default model('RecentlyViewedJob', recentlyViewedJobSchema)
