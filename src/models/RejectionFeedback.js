import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'
import { FEEDBACK_REASONS, FEEDBACK_STAGES, FEEDBACK_STATUSES, NOTIFICATION_STATES } from '../utils/rejectionFeedback.js'

// One record per rejected candidate. The employer's own words live in `submissions`
// (and the latest in `employerRemarks`), apart from `versions`, which holds only what a
// reviewer approved for the candidate. Delivered versions are append-only — a correction
// adds a new version rather than overwriting one a candidate may already have read, and
// every employer resubmission is kept in `submissions`. Nothing here is ever sent to a
// candidate directly: see toCandidateView() in utils/rejectionFeedback.js.

const versionSchema = new Schema(
  {
    number: { type: Number, required: true },
    summary: { type: String, required: true },
    // Snapshot of the structured reasons as approved (code + candidate-facing label).
    reasons: [{ _id: false, code: String, label: String }],
    improvementAreas: [{ _id: false, code: String, label: String, suggestion: String }],
    approvedBy: { type: String, required: true },
    approvedByName: { type: String, default: '' },
    approvedAt: { type: Date, default: Date.now },
  },
  { _id: false }
)

const submissionSchema = new Schema(
  {
    revision: { type: Number, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    stage: { type: String, enum: Object.keys(FEEDBACK_STAGES), required: true },
    reasons: [String],
    remarks: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
)

const auditSchema = new Schema(
  {
    action: { type: String, required: true },
    actorType: { type: String, enum: ['employer', 'staff', 'candidate', 'system'], required: true },
    actorId: { type: String, default: '' },
    actorName: { type: String, default: '' },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    // Reviewer / system notes. Private: never part of any candidate or employer response.
    note: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
)

const noteSchema = new Schema(
  { text: { type: String, required: true }, by: { type: String, required: true }, byName: { type: String, default: '' }, at: { type: Date, default: Date.now } },
  { _id: false }
)

const rejectionFeedbackSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', default: null, index: true },
    candidate: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, unique: true },
    application: { type: Schema.Types.ObjectId, ref: 'Application', required: true, index: true },
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    // Denormalised at submission so the queue can be searched and sorted without joins.
    candidateName: { type: String, default: '' },
    companyName: { type: String, default: '' },
    jobTitle: { type: String, default: '' },
    rejectedAt: { type: Date, default: null },

    stage: { type: String, enum: Object.keys(FEEDBACK_STAGES), required: true },
    reasons: { type: [String], enum: Object.keys(FEEDBACK_REASONS), validate: (v) => v.length > 0 },
    outcome: { type: String, enum: ['skills', 'non_skill', 'mixed'], required: true },
    // Private to the employer and reviewers; excluded unless explicitly selected.
    employerRemarks: { type: String, default: '', select: false },
    submissions: { type: [submissionSchema], default: [], select: false },

    status: { type: String, enum: FEEDBACK_STATUSES, default: 'pending_review' },
    // Bumped on every change. Reviewer actions carry the rev they were looking at, so a
    // decision made on a stale view (someone else acted meanwhile) is refused.
    rev: { type: Number, default: 0 },

    // Why a reviewer sent it back / asked for clarification — shown to the employer.
    clarification: {
      kind: { type: String, enum: ['returned', 'flagged', 'dispute'] },
      reason: String,
      message: String,
      requestedAt: Date,
    },

    // Internal flag (private) and reviewer notes (private).
    flag: { reason: { type: String, select: false }, at: Date, by: String },
    notes: { type: [noteSchema], default: [], select: false },

    versions: { type: [versionSchema], default: [] },

    // Delivery of the "feedback available" message for the latest approved version,
    // tracked separately from approval itself.
    notification: {
      status: { type: String, enum: NOTIFICATION_STATES },
      version: Number,
      attempts: { type: Number, default: 0 },
      lastAttemptAt: Date,
      sentAt: Date,
      error: String,
    },

    dispute: {
      status: { type: String, enum: ['open', 'investigating', 'resolved'] },
      kind: { type: String, enum: ['problem'], default: 'problem' },
      // Candidate's own words; reviewers only.
      reason: { type: String, select: false },
      raisedAt: Date,
      // The delivered version this dispute is about, so an upheld dispute can't be re-raised on the same text.
      version: Number,
      resolvedAt: Date,
      resolvedBy: String,
      resolutionAction: String,
      resolutionSummary: { type: String, select: false },
    },

    audit: { type: [auditSchema], default: [], select: false },
  },
  { timestamps: true }
)

rejectionFeedbackSchema.index({ status: 1, updatedAt: -1 })
rejectionFeedbackSchema.index({ status: 1, createdAt: -1 })
rejectionFeedbackSchema.index({ company: 1, status: 1 })
rejectionFeedbackSchema.index({ 'notification.status': 1 })

applyIdTransform(rejectionFeedbackSchema, { company: 'companyId', job: 'jobId', candidate: 'candidateId', application: 'applicationId', employee: 'employeeId' })

export default model('RejectionFeedback', rejectionFeedbackSchema)
