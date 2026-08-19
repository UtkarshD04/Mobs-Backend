import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'
import { initialsOf } from '../utils/initials.js'

const candidateSchema = new Schema(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    job: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
    batch: { type: Schema.Types.ObjectId, ref: 'Batch', default: null },
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    application: { type: Schema.Types.ObjectId, ref: 'Application', default: null },
    name: { type: String, required: true },
    headline: { type: String, default: '' },
    appliedFor: { type: String, required: true },
    experienceYears: { type: Number, default: 0 },
    location: { type: String, default: '' },
    expectedSalary: { type: String, default: '' },
    availability: { type: String, default: '' },
    resumeVerified: { type: Boolean, default: false },
    identityVerified: { type: Boolean, default: false },
    hasVideoIntro: { type: Boolean, default: false },
    hasPortfolio: { type: Boolean, default: false },
    certificates: { type: Number, default: 0 },
    skills: { type: [String], default: [] },
    education: [{ degree: String, institute: String, year: String }],
    projects: [{ name: String, description: String }],
    workHistory: [{ company: String, role: String, duration: String }],
    portfolioLink: { type: String, default: '' },
    email: { type: String, default: '' },
    phone: { type: String, default: '' },
    source: { type: String, default: 'Mzobs Verified Pool' },
    stage: { type: String, enum: ['shared', 'shortlisted', 'interviewing', 'offered', 'hired', 'rejected'], default: 'shared' },
    sharedOn: { type: Date, default: Date.now },
    rejectionReason: { type: String, default: null },
  },
  { timestamps: true }
)

applyIdTransform(candidateSchema, { job: 'jobId', batch: 'batchId', employee: 'employeeId', application: 'applicationId' })

const baseTransform = candidateSchema.options.toJSON.transform
candidateSchema.options.toJSON.transform = (doc, ret, options) => {
  ret = baseTransform(doc, ret, options)
  ret.initials = initialsOf(ret.name)
  return ret
}

export default model('Candidate', candidateSchema)
