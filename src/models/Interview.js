import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const interviewSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    candidate: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    candidateName: { type: String, required: true },
    initials: { type: String, default: '' },
    role: { type: String, required: true },
    round: { type: String, default: '' },
    startsAt: { type: Date, required: true },
    durationMins: { type: Number, default: 30 },
    mode: { type: String, enum: ['Video Call', 'On-site'], required: true },
    meetingLink: { type: String, default: null },
    location: { type: String, default: null },
    panel: { type: [String], default: [] },
    status: {
      type: String,
      enum: ['Confirmed', 'Awaiting confirmation', 'Completed', 'Cancelled', 'Rescheduled'],
      default: 'Confirmed',
    },
    // Result of emailing the candidate about this interview, when the recruiter asked for it.
    email: {
      kind: { type: String, enum: ['scheduled', 'rescheduled', 'cancelled'] },
      status: { type: String, enum: ['sent', 'failed', 'not_configured', 'no_email', 'not_allowed'] },
      to: String, // masked
      sentAt: Date,
      error: String,
    },
    // Structured scorecards (one per interviewer). `panel` stays as free-text names for older interviews.
    interviewers: { type: [{ _id: false, user: { type: Schema.Types.ObjectId, ref: 'User' }, name: String }], default: [] },
    feedbackDueOn: { type: Date, default: null },
    reminderAt: { type: Date, default: null },
    reminderSentAt: { type: Date, default: null },
    scorecards: {
      type: [
        {
          _id: false,
          interviewer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          interviewerName: String,
          ratings: {
            communication: { type: Number, min: 1, max: 5 },
            technical: { type: Number, min: 1, max: 5 },
            roleFit: { type: Number, min: 1, max: 5 },
            problemSolving: { type: Number, min: 1, max: 5 },
            cultureFit: { type: Number, min: 1, max: 5 },
          },
          recommendation: { type: String, enum: ['Strong Yes', 'Yes', 'Maybe', 'No'], required: true },
          comments: { type: String, default: '', maxlength: 2000 },
          submittedAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    feedback: {
      score: Number,
      notes: String,
      outcome: { type: String, enum: ['Selected', 'Not selected'] },
    },
  },
  { timestamps: true }
)

interviewSchema.index({ company: 1, startsAt: 1 })

applyIdTransform(interviewSchema, { candidate: 'candidateId', job: 'jobId' })

export default model('Interview', interviewSchema)
