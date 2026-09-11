import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// Persistent "this employer has paid a credit for this candidate" grant —
// distinct from ResumeAccessLog (which logs every individual view/download,
// even after entitlement is already established). Existence of a row here
// is the entitlement itself: once created, the employer can view/download
// this candidate's contact + resume unlimited times at no further cost.
// The unique index is the hard guarantee against double-charging — it's
// enforced at the DB level, not just in application code, so even a bug in
// the "already unlocked?" pre-check can't create two grants (and can't
// silently double-spend a credit) for the same employer+candidate pair.
const candidateUnlockSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    candidate: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', default: null },
    creditsUsed: { type: Number, default: 1, min: 1 },
    unlockedAt: { type: Date, default: Date.now },
    unlockedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

candidateUnlockSchema.index({ company: 1, candidate: 1 }, { unique: true })
candidateUnlockSchema.index({ company: 1, createdAt: -1 })

applyIdTransform(candidateUnlockSchema, { company: 'companyId', candidate: 'candidateId', job: 'jobId', unlockedBy: 'unlockedById' })

export default model('CandidateUnlock', candidateUnlockSchema)
