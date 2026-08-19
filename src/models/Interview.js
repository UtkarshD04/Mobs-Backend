import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const interviewSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    candidate: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
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
    feedback: {
      score: Number,
      notes: String,
      outcome: { type: String, enum: ['Selected', 'Not selected'] },
    },
  },
  { timestamps: true }
)

applyIdTransform(interviewSchema, { candidate: 'candidateId' })

export default model('Interview', interviewSchema)
