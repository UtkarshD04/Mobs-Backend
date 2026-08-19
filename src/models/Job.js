import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const jobSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    title: { type: String, required: true },
    department: { type: String, required: true },
    employmentType: { type: String, enum: ['Full-time', 'Part-time', 'Contract', 'Internship'], required: true },
    experienceMin: { type: Number, required: true },
    experienceMax: { type: Number, required: true },
    salaryMin: { type: Number, required: true },
    salaryMax: { type: Number, required: true },
    vacancies: { type: Number, required: true, min: 1 },
    location: { type: String, required: true },
    workMode: { type: String, enum: ['On-site', 'Hybrid', 'Remote'], required: true },
    skills: { type: [String], default: [] },
    // Matches Employee.skillTrack.key — powers the employee-facing "My track" filter.
    track: { type: String, enum: ['analytics', 'design', 'sales', 'marketing', 'hr', 'support', 'tech', 'ops', ''], default: '' },
    description: { type: String, required: true },
    benefits: { type: [String], default: [] },
    deadline: { type: String, required: true },

    status: {
      type: String,
      enum: ['draft', 'pending_review', 'awaiting_payment', 'sourcing', 'delivered', 'closed', 'archived'],
      default: 'draft',
    },
    // Set by Mzobs staff on approval — gates whether the employee-facing job
    // board (GET /api/employee/jobs) lists this opening.
    visibleToCandidates: { type: Boolean, default: false },
    feeTotal: { type: Number, default: 0 },
    feeStatus: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
    paidOn: { type: Date, default: null },
    invoiceId: { type: String, default: null },
    resumesPromised: { type: Number, default: 0 },
    candidatesShared: { type: Number, default: 0 },
    hiresSelected: { type: Number, default: 0 },
    submittedOn: { type: Date, default: null },
    postedOn: { type: Date, default: null },
    updatedOn: { type: Date, default: Date.now },
    hiringTeam: { type: [String], default: [] },
  },
  { timestamps: true }
)

applyIdTransform(jobSchema)

export default model('Job', jobSchema)
