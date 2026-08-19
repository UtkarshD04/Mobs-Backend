import { Schema, model } from 'mongoose'
import { applyIdTransform } from '../utils/toJSON.js'

const educationSchema = new Schema({ degree: String, institute: String, year: String }, { _id: false })
const projectSchema = new Schema({ name: String, description: String, tech: { type: [String], default: [] } }, { _id: false })
const workHistorySchema = new Schema({ company: String, role: String, duration: String }, { _id: false })

const resumeSchema = new Schema(
  {
    file: { type: String, default: '' },
    url: { type: String, default: '' },
    version: { type: Number, default: 0 },
    uploadedOn: { type: Date, default: null },
    status: { type: String, enum: ['none', 'pending', 'verified', 'changes', 'rejected'], default: 'none' },
    verifiedOn: { type: Date, default: null },
    reviewer: { type: String, default: '' },
    reviewerRole: { type: String, default: '' },
    score: { type: Number, default: null },
    note: { type: String, default: '' },
  },
  { _id: false }
)

const resumeHistorySchema = new Schema(
  {
    version: Number,
    file: String,
    url: String,
    uploadedOn: Date,
    score: Number,
    status: String,
  },
  { _id: false }
)

const skillTrackSchema = new Schema(
  {
    key: { type: String, default: '' },
    label: { type: String, default: '' },
    grade: { type: String, default: '' },
    assignedOn: { type: Date, default: null },
    assignedBy: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { _id: false }
)

const subscriptionSchema = new Schema(
  {
    status: { type: String, enum: ['unpaid', 'paid'], default: 'unpaid' },
    amount: { type: Number, default: 99 },
    paidOn: { type: Date, default: null },
  },
  { _id: false }
)

const employeeSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    experience: { type: String, enum: ['fresher', 'experienced'], default: 'fresher' },
    graduation: { type: String, required: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    lastActiveAt: { type: Date, default: null },
    resetPasswordToken: { type: String, default: null, select: false },
    resetPasswordExpires: { type: Date, default: null, select: false },

    // Profile — collected across the onboarding wizard / profile editor
    phone: { type: String, default: '' },
    dob: { type: String, default: '' },
    gender: { type: String, default: '' },
    maritalStatus: { type: String, default: '' },
    currentCity: { type: String, default: '' },
    relocationOk: { type: Boolean, default: false },
    currentCompany: { type: String, default: '' },
    designation: { type: String, default: '' },
    experienceYears: { type: Number, default: 0 },
    currentCtc: { type: String, default: '' },
    noticePeriod: { type: String, default: '' },
    interests: { type: [String], default: [] },
    preferredRole: { type: String, default: '' },
    expectedSalaryMin: { type: Number, default: null },
    expectedSalaryMax: { type: Number, default: null },
    preferredLocations: { type: [String], default: [] },
    skills: { type: [String], default: [] },
    education: { type: [educationSchema], default: [] },
    projects: { type: [projectSchema], default: [] },
    workHistory: { type: [workHistorySchema], default: [] },
    portfolioLink: { type: String, default: '' },
    linkedin: { type: String, default: '' },
    github: { type: String, default: '' },
    resumeHeadline: { type: String, default: '' },

    resume: { type: resumeSchema, default: () => ({}) },
    resumeHistory: { type: [resumeHistorySchema], default: [] },
    skillTrack: { type: skillTrackSchema, default: () => ({}) },
    subscription: { type: subscriptionSchema, default: () => ({}) },
  },
  { timestamps: true }
)

applyIdTransform(employeeSchema)

export default model('Employee', employeeSchema)
