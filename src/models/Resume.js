import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// Bulk-sourced resumes the admin intakes and hands out to staff to verify.
// Deliberately separate from `Employee.resume`, which is a job-seeker's own
// self-uploaded resume feeding the existing Dispatch/Batch pipeline.
const resumeSchema = new Schema(
  {
    name: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    file: { type: String, required: true },
    url: { type: String, required: true },
    uploadedOn: { type: Date, default: Date.now },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'StaffUser' },

    status: { type: String, enum: ['pending', 'verified', 'changes', 'rejected'], default: 'pending' },

    assignedTo: { type: Schema.Types.ObjectId, ref: 'StaffUser', default: null },
    assignedOn: { type: Date, default: null },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'StaffUser', default: null },

    verifiedOn: { type: Date, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'StaffUser', default: null },

    reviewNote: { type: String, default: '' },
    score: { type: Number, default: null },
  },
  { timestamps: true }
)

applyIdTransform(resumeSchema, { uploadedBy: 'uploadedById', assignedTo: 'assignedToId', assignedBy: 'assignedById', verifiedBy: 'verifiedById' })

export default model('Resume', resumeSchema)
