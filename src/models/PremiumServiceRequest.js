import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'
import { PREMIUM_SERVICE_KEYS } from '../config/premiumPlan.js'

// The Premium services pipeline: a paid candidate requests a human-delivered
// service (see PREMIUM_SERVICES), Operations picks it up, schedules it if it
// needs a session, works on it and marks it delivered with a summary/link.
//
//   requested -> scheduled -> in_progress -> delivered
//        \___________\____________\______-> cancelled
export const SERVICE_REQUEST_STATUSES = ['requested', 'scheduled', 'in_progress', 'delivered', 'cancelled']
export const OPEN_SERVICE_REQUEST_STATUSES = ['requested', 'scheduled', 'in_progress']

const historySchema = new Schema(
  {
    status: { type: String, enum: SERVICE_REQUEST_STATUSES, required: true },
    changedOn: { type: Date, default: Date.now },
    // 'employee' or the staff member's name.
    changedBy: { type: String, default: 'employee' },
  },
  { _id: false }
)

const premiumServiceRequestSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    service: { type: String, enum: PREMIUM_SERVICE_KEYS, required: true },
    status: { type: String, enum: SERVICE_REQUEST_STATUSES, default: 'requested', index: true },
    statusHistory: { type: [historySchema], default: [] },
    // From the candidate when requesting.
    note: { type: String, default: '', maxlength: 1000 },
    preferredTime: { type: String, default: '', maxlength: 200 },
    // Filled in by Operations as the request moves along.
    assignedTo: { type: String, default: '' },
    scheduledFor: { type: Date, default: null },
    meetingLink: { type: String, default: '' },
    // What the candidate sees once it's delivered (and any update before that).
    candidateMessage: { type: String, default: '', maxlength: 2000 },
    deliverableLink: { type: String, default: '' },
    // Internal only — never sent to the candidate.
    staffNote: { type: String, default: '', maxlength: 2000 },
    deliveredOn: { type: Date, default: null },
  },
  { timestamps: true }
)

premiumServiceRequestSchema.index({ employee: 1, service: 1, status: 1 })

applyIdTransform(premiumServiceRequestSchema, { employee: 'employeeId' })

export default model('PremiumServiceRequest', premiumServiceRequestSchema)
