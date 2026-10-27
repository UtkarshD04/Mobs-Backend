import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

// Append-only record of sensitive actions in a company's recruiter workspace.
const auditLogSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    action: { type: String, required: true },
    // What it happened to, for display ("Priya Nair") and linking.
    targetType: { type: String, default: '' },
    targetId: { type: String, default: '' },
    targetLabel: { type: String, default: '' },
    detail: { type: String, default: '', maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

auditLogSchema.index({ company: 1, createdAt: -1 })
auditLogSchema.index({ company: 1, action: 1, createdAt: -1 })

applyIdTransform(auditLogSchema)

export default model('AuditLog', auditLogSchema)
