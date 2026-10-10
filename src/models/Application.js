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
    // Snapshot of the employee's subscription state at apply time — powers
    // priority sorting in staff triage without a join back to Employee.
    premium: { type: Boolean, default: false },
    // First time the employer opened this candidate's profile or resume (null = not yet).
    // Applications reach the employer the moment they're made, so 'shared' alone
    // doesn't mean anyone has looked at it.
    employerViewedOn: { type: Date, default: null },
    // Why the employer (or staff) turned this application down, and how far it had got
    // ('shared', 'shortlisted' or 'interview') — written when the status becomes 'rejected'
    // and cleared if it ever leaves it. This is candidate-facing: it's what the candidate
    // reads in application tracking, so it must be the employer's own words, not an internal note.
    rejectionReason: { type: String, default: '', maxlength: 500 },
    rejectedAfter: { type: String, default: '' },
  },
  { timestamps: true }
)

applicationSchema.index({ employee: 1, job: 1 }, { unique: true })

applyIdTransform(applicationSchema, { employee: 'employeeId', job: 'jobId' })

export default model('Application', applicationSchema)
