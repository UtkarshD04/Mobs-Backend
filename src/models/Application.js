import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

export const APPLICATION_STATUSES = ['new', 'screening', 'shortlisted', 'shared', 'interview', 'selected', 'rejected', 'withdrawn']

const statusHistoryEntrySchema = new Schema(
  {
    status: { type: String, enum: APPLICATION_STATUSES, required: true },
    changedOn: { type: Date, default: Date.now },
    // 'employee' (self-withdraw) vs a StaffUser id — kept as a free-form
    // string rather than a ref since the actor type varies by entry.
    changedBy: { type: String, default: 'employee' },
  },
  { _id: false }
)

const applicationSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    status: {
      type: String,
      enum: APPLICATION_STATUSES,
      default: 'new',
    },
    statusHistory: { type: [statusHistoryEntrySchema], default: [] },
    fit: { type: Number, default: null },
    note: { type: String, default: '' },
    appliedOn: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

applicationSchema.index({ employee: 1, job: 1 }, { unique: true })

applyIdTransform(applicationSchema, { employee: 'employeeId', job: 'jobId' })

export default model('Application', applicationSchema)
