import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

export const FOLLOW_UP_TYPES = ['missing_feedback', 'returned_unanswered', 'clarification_pending']

// A case where Mzobs is waiting on an employer. Cases are only ever opened from real
// records (a rejected candidate with no feedback, or feedback a reviewer sent back that
// nobody has answered) — see utils/feedbackFollowUps.js — and closed when the required
// action is verified.

const attemptSchema = new Schema(
  {
    kind: { type: String, enum: ['notification', 'contact'], required: true },
    channel: { type: String, default: '' }, // in_app | phone | email | other
    ok: { type: Boolean, default: true },
    error: { type: String, default: '' },
    note: { type: String, default: '' },
    by: { type: String, default: '' },
    byName: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
)

const noteSchema = new Schema({ text: { type: String, required: true }, by: String, byName: String, at: { type: Date, default: Date.now } }, { _id: false })

const followUpSchema = new Schema(
  {
    type: { type: String, enum: FOLLOW_UP_TYPES, required: true },
    status: { type: String, enum: ['open', 'completed'], default: 'open' },
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    candidate: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
    application: { type: Schema.Types.ObjectId, ref: 'Application', default: null },
    job: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    feedback: { type: Schema.Types.ObjectId, ref: 'RejectionFeedback', default: null },

    candidateName: { type: String, default: '' },
    companyName: { type: String, default: '' },
    jobTitle: { type: String, default: '' },
    // Who at the employer to chase (snapshot at opening).
    contactName: { type: String, default: '' },
    contactEmail: { type: String, default: '' },
    outstandingAction: { type: String, default: '' },
    dueSince: { type: Date, required: true },

    lastContactedAt: { type: Date, default: null },
    lastNotifiedAt: { type: Date, default: null },
    nextFollowUpAt: { type: Date, default: null },

    attempts: { type: [attemptSchema], default: [] },
    notes: { type: [noteSchema], default: [] },

    completedAt: Date,
    completedBy: String,
    autoCompleted: { type: Boolean, default: false },
  },
  { timestamps: true }
)

// At most one open case per candidate and kind.
followUpSchema.index({ candidate: 1, type: 1 }, { unique: true, partialFilterExpression: { status: 'open' } })
followUpSchema.index({ status: 1, dueSince: 1 })

applyIdTransform(followUpSchema, { company: 'companyId', candidate: 'candidateId', application: 'applicationId', job: 'jobId', feedback: 'feedbackId' })

export default model('FeedbackFollowUp', followUpSchema)
