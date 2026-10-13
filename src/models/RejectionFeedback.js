import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'
import { FEEDBACK_REASONS, FEEDBACK_STAGES, FEEDBACK_STATUSES } from '../utils/rejectionFeedback.js'

// One record per rejected candidate. The employer's own words (`employerRemarks`)
// stay here, apart from `versions`, which holds only what a reviewer approved
// for the candidate. Delivered versions are append-only — a correction adds a
// new version rather than overwriting one a candidate may already have read.
// Nothing on this model is ever sent to a candidate directly: see
// toCandidateView() in utils/rejectionFeedback.js.

const versionSchema = new Schema(
  {
    number: { type: Number, required: true },
    summary: { type: String, required: true },
    improvementAreas: [{ _id: false, code: String, label: String, suggestion: String }],
    approvedBy: { type: String, required: true },
    approvedAt: { type: Date, default: Date.now },
  },
  { _id: false }
)

const auditSchema = new Schema(
  {
    action: { type: String, required: true },
    actorType: { type: String, enum: ['employer', 'staff', 'candidate', 'system'], required: true },
    actorId: { type: String, default: '' },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    // Reviewer / system notes. Private: never part of any candidate or
    // employer response.
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
)

const rejectionFeedbackSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    candidate: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, unique: true },
    application: { type: Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    stage: { type: String, enum: Object.keys(FEEDBACK_STAGES), required: true },
    reasons: { type: [String], enum: Object.keys(FEEDBACK_REASONS), validate: (v) => v.length > 0 },
    outcome: { type: String, enum: ['skills', 'non_skill', 'mixed'], required: true },
    // Private to the employer and reviewers; excluded unless explicitly selected.
    employerRemarks: { type: String, default: '', select: false },

    status: { type: String, enum: FEEDBACK_STATUSES, default: 'pending_review', index: true },

    // Why a reviewer sent it back / flagged it — shown to the employer.
    clarification: {
      kind: { type: String, enum: ['returned', 'flagged', 'dispute'] },
      message: String,
      requestedAt: Date,
    },

    versions: { type: [versionSchema], default: [] },

    dispute: {
      status: { type: String, enum: ['open', 'resolved'] },
      // Candidate's own words; reviewers only.
      reason: { type: String, select: false },
      raisedAt: Date,
      // The delivered version this dispute is about, so an upheld dispute can't be re-raised on the same text.
      version: Number,
      resolvedAt: Date,
    },

    audit: { type: [auditSchema], default: [], select: false },
  },
  { timestamps: true }
)

rejectionFeedbackSchema.index({ status: 1, updatedAt: -1 })

applyIdTransform(rejectionFeedbackSchema, { company: 'companyId', job: 'jobId', candidate: 'candidateId', application: 'applicationId', employee: 'employeeId' })

export default model('RejectionFeedback', rejectionFeedbackSchema)
