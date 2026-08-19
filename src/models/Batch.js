import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// One Batch per paid Job — created when Mzobs staff record payment for a
// requirement. Staff then dispatch resumes into it in rounds; the employer
// only ever sees this row (never the raw Applications behind it).
const batchSchema = new Schema(
  {
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, unique: true, index: true },
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    jobTitle: { type: String, required: true },
    openings: { type: Number, default: 0 },
    resumesPromised: { type: Number, default: 0 },
    resumesDelivered: { type: Number, default: 0 },
    selected: { type: Number, default: 0 },
    status: { type: String, enum: ['preparing', 'delivered', 'closed'], default: 'preparing' },
    deliveredOn: { type: Date, default: null },
    note: { type: String, default: '' },
    // Staff-internal dispatch log — which applications went out and when.
    // Not part of the employer-facing contract.
    dispatches: {
      type: [
        {
          application: { type: Schema.Types.ObjectId, ref: 'Application' },
          dispatchedOn: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
  },
  { timestamps: true }
)

applyIdTransform(batchSchema, { job: 'jobId', company: 'companyId' })

export default model('Batch', batchSchema)
