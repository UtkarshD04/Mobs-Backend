import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const offerSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    candidate: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true },
    candidateName: { type: String, required: true },
    initials: { type: String, default: '' },
    role: { type: String, required: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    ctc: { type: Number, required: true },
    joiningDate: { type: Date, required: true },
    status: { type: String, enum: ['draft', 'pending', 'accepted', 'rejected'], default: 'pending' },
    sentOn: { type: Date, default: Date.now },
    respondedOn: { type: Date, default: null },
    expiresOn: { type: Date, required: true },
  },
  { timestamps: true }
)

applyIdTransform(offerSchema, { candidate: 'candidateId', job: 'jobId' })

export default model('Offer', offerSchema)
