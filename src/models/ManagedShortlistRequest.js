import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// "Need help shortlisting?" — an employer asks the MZOBS operations team for a curated shortlist for one job.
//   requested -> in_review -> shortlisting -> shortlist_shared -> closed
export const MANAGED_STATUSES = ['requested', 'in_review', 'shortlisting', 'shortlist_shared', 'closed']
export const OPEN_MANAGED_STATUSES = ['requested', 'in_review', 'shortlisting', 'shortlist_shared']
export const MANAGED_URGENCY = ['standard', 'high', 'urgent']

const historySchema = new Schema({ status: { type: String, enum: MANAGED_STATUSES, required: true }, at: { type: Date, default: Date.now }, by: { type: String, default: '' } }, { _id: false })

const managedShortlistSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedByName: { type: String, default: '' },
    urgency: { type: String, enum: MANAGED_URGENCY, default: 'standard' },
    idealProfile: { type: String, required: true, maxlength: 2000 },
    notes: { type: String, default: '', maxlength: 1000 },
    status: { type: String, enum: MANAGED_STATUSES, default: 'requested' },
    statusHistory: { type: [historySchema], default: [] },
    // Operations side. `staffNote` is internal and never sent to the employer.
    assignedTo: { type: String, default: '' },
    staffNote: { type: String, default: '', select: false },
    // What the employer sees once the shortlist is shared.
    shortlistMessage: { type: String, default: '', maxlength: 2000 },
    sharedCandidates: { type: [{ type: Schema.Types.ObjectId, ref: 'Candidate' }], default: [] },
    sharedOn: { type: Date, default: null },
  },
  { timestamps: true }
)

managedShortlistSchema.index({ company: 1, job: 1, createdAt: -1 })
managedShortlistSchema.index({ status: 1, createdAt: -1 })

applyIdTransform(managedShortlistSchema, { company: 'companyId', job: 'jobId', requestedBy: 'requestedById' })

export default model('ManagedShortlistRequest', managedShortlistSchema)
