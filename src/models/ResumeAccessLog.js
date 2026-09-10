import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// Append-only audit trail for every time an employer actually opens a
// candidate's resume or private contact details — separate from the
// candidate-facing "resumesShared" counters, which track delivery, not access.
const resumeAccessLogSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    candidate: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    application: { type: Schema.Types.ObjectId, ref: 'Application', default: null },
    action: { type: String, enum: ['resume_viewed', 'resume_downloaded', 'private_details_viewed'], required: true },
    accessedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

resumeAccessLogSchema.index({ company: 1, createdAt: -1 })

applyIdTransform(resumeAccessLogSchema, { company: 'companyId', candidate: 'candidateId', employee: 'employeeId', application: 'applicationId', accessedBy: 'accessedById' })

export default model('ResumeAccessLog', resumeAccessLogSchema)
