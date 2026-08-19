import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const feedbackSchema = new Schema({ tone: { type: String, enum: ['good', 'warn'] }, text: String }, { _id: false })

const scoresSchema = new Schema(
  {
    comm: { type: Number, default: null },
    domain: { type: Number, default: null },
    attitude: { type: Number, default: null },
    overall: { type: Number, default: null },
  },
  { _id: false }
)

const mockInterviewSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    status: { type: String, enum: ['not_scheduled', 'scheduled', 'completed', 'no_show'], default: 'not_scheduled' },
    when: { type: Date, default: null },
    panel: { type: String, default: '' },
    panelRole: { type: String, default: '' },
    mode: { type: String, default: '' },
    link: { type: String, default: '' },
    duration: { type: String, default: '' },
    scores: { type: scoresSchema, default: () => ({}) },
    feedback: { type: [feedbackSchema], default: [] },
    completedOn: { type: Date, default: null },
    scheduledBy: { type: Schema.Types.ObjectId, ref: 'StaffUser', default: null },
  },
  { timestamps: true }
)

applyIdTransform(mockInterviewSchema, { employee: 'employeeId', scheduledBy: 'scheduledById' })

export default model('MockInterview', mockInterviewSchema)
