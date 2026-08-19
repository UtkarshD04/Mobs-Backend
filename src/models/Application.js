import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const applicationSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
    status: {
      type: String,
      enum: ['new', 'screening', 'shortlisted', 'shared', 'interview', 'selected', 'rejected'],
      default: 'new',
    },
    fit: { type: Number, default: null },
    note: { type: String, default: '' },
    appliedOn: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

applicationSchema.index({ employee: 1, job: 1 }, { unique: true })

applyIdTransform(applicationSchema, { employee: 'employeeId', job: 'jobId' })

export default model('Application', applicationSchema)
