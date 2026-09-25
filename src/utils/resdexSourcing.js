import mongoose from 'mongoose'
import Candidate from '../models/Candidate.js'
import Job from '../models/Job.js'

// Shown as the candidate's "applied for" when they were sourced from the
// resume database without being attached to any job posting.
export const NO_JOB_LABEL = 'Resume database'

export class JobNotFoundError extends Error {
  constructor() {
    super('Job not found')
    this.name = 'JobNotFoundError'
  }
}

// Returns this company's Candidate row for a resume-database employee,
// creating it on first unlock. The row is the same one the Applicants
// pipeline uses, so re-unlocking reuses it (and never charges twice).
//
// `jobId` is optional: an employer with no job postings yet can still spend a
// credit to see a CV. With one, the candidate joins that job's pipeline; a
// jobId that isn't this company's throws JobNotFoundError.
export async function findOrCreateSourcedCandidate({ companyId, employee, jobId }) {
  const existing = await Candidate.findOne({ company: companyId, employee: employee._id })
  if (existing) return existing

  let job = null
  if (jobId) {
    job = mongoose.isValidObjectId(jobId) ? await Job.findOne({ _id: jobId, company: companyId }) : null
    if (!job) throw new JobNotFoundError()
  }

  return Candidate.create({
    company: companyId,
    job: job?._id ?? null,
    employee: employee._id,
    name: employee.name,
    headline: employee.resumeHeadline,
    appliedFor: job?.title ?? NO_JOB_LABEL,
    experienceYears: employee.experienceYears,
    location: employee.currentCity,
    expectedSalary: employee.expectedSalaryMax ? `₹${employee.expectedSalaryMax}` : '',
    skills: employee.skills,
    education: employee.education,
    projects: employee.projects,
    workHistory: employee.workHistory,
    portfolioLink: employee.portfolioLink,
    email: employee.email,
    phone: employee.phone,
    resumeVerified: employee.resume?.status === 'verified',
    identityVerified: false,
    source: 'Resdex Search',
    stage: 'shared',
    sharedOn: new Date(),
    premium: !!employee.isPremium,
  })
}
