import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// A candidate's full history inside one company: stage moves, notes, assignments, interviews and
// outbound messages. Employer-internal — never returned by any candidate-facing route.
export const EVENT_TYPES = ['stage', 'note', 'assign', 'tags', 'followup', 'interview', 'offer', 'comm', 'reject']

const candidateEventSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    candidate: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    type: { type: String, enum: EVENT_TYPES, required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: '' },
    text: { type: String, required: true, maxlength: 2000 },
    // stage: { from, to }; comm: { templateKey, channel, status, subject }
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

candidateEventSchema.index({ company: 1, candidate: 1, createdAt: -1 })
candidateEventSchema.index({ company: 1, job: 1, type: 1, createdAt: -1 })

applyIdTransform(candidateEventSchema, { candidate: 'candidateId', job: 'jobId', actor: 'actorId' })

export default model('CandidateEvent', candidateEventSchema)
