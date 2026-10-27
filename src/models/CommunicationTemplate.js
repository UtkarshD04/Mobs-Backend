import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'
import { TEMPLATE_KEYS } from '../utils/commTemplates.js'

// A company's edited copy of one of the built-in message templates. No row = the built-in default applies.
const templateSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    key: { type: String, enum: TEMPLATE_KEYS, required: true },
    subject: { type: String, required: true, maxlength: 150 },
    body: { type: String, required: true, maxlength: 5000 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
)

templateSchema.index({ company: 1, key: 1 }, { unique: true })

applyIdTransform(templateSchema)

export default model('CommunicationTemplate', templateSchema)
