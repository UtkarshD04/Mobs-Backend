import 'dotenv/config'
import { connectDB } from '../src/config/db.js'
import { env } from '../src/config/env.js'
import Company from '../src/models/Company.js'
import StaffUser from '../src/models/StaffUser.js'
import Job from '../src/models/Job.js'

// One-off: post Mzobs's own openings directly to the live candidate job
// board, mirroring what StaffUser.createJob (POST /api/staff/jobs) does —
// status 'sourcing', visibleToCandidates true, no employer/invoice involved.
const JOBS = [
  {
    title: 'Web Developer Intern',
    department: 'Engineering',
    employmentType: 'Internship',
    experienceMin: 0,
    experienceMax: 1,
    salaryMin: 120000,
    salaryMax: 120000,
    vacancies: 2,
    location: 'Hyderabad, Telangana',
    workMode: 'On-site',
    skills: ['HTML', 'CSS', 'JavaScript', 'React', 'Git'],
    track: 'tech',
    description:
      'Work alongside the Mzobs engineering team building and shipping real features for the platform (React + Node). You will get hands-on production experience — writing code that actually goes live, not just training exercises. Stipend: ₹10,000/month. Duration: 3–6 months, with a possible full-time offer for strong performers.',
    benefits: [
      'Certificate of internship',
      'Letter of recommendation for outstanding performers',
      'Real hands-on project experience, not busywork',
      'Opportunity for full-time conversion based on performance',
    ],
  },
  {
    title: 'Digital Marketing Intern',
    department: 'Marketing',
    employmentType: 'Internship',
    experienceMin: 0,
    experienceMax: 1,
    salaryMin: 120000,
    salaryMax: 120000,
    vacancies: 2,
    location: 'Hyderabad, Telangana',
    workMode: 'On-site',
    skills: ['SEO', 'Social Media Marketing', 'Content Writing', 'Google Ads', 'Analytics'],
    track: 'marketing',
    description:
      'Own day-to-day social content, assist with SEO and ad campaigns, and track performance across channels to help grow Mzobs\'s reach with both employers and candidates. Stipend: ₹10,000/month. Duration: 3–6 months, with a possible full-time offer for strong performers.',
    benefits: [
      'Certificate of internship',
      'Letter of recommendation for outstanding performers',
      'Real campaign ownership from day one',
      'Opportunity for full-time conversion based on performance',
    ],
  },
  {
    title: 'Business Development Executive (BDE) Intern',
    department: 'Sales & Business Development',
    employmentType: 'Internship',
    experienceMin: 0,
    experienceMax: 1,
    salaryMin: 120000,
    salaryMax: 120000,
    vacancies: 2,
    location: 'Hyderabad, Telangana',
    workMode: 'On-site',
    skills: ['Communication', 'Lead Generation', 'Cold Calling', 'CRM', 'Negotiation'],
    track: 'sales',
    description:
      'Identify and reach out to potential employer clients, pitch Mzobs\'s hiring solutions, and support the sales team in closing new accounts. Stipend: ₹10,000/month. Duration: 3–6 months, with a possible full-time offer for strong performers.',
    benefits: [
      'Certificate of internship',
      'Letter of recommendation for outstanding performers',
      'Direct client-facing experience',
      'Opportunity for full-time conversion based on performance',
    ],
  },
  {
    title: 'HR Manager',
    department: 'Human Resources',
    employmentType: 'Full-time',
    experienceMin: 3,
    experienceMax: 8,
    salaryMin: 600000,
    salaryMax: 1000000,
    vacancies: 1,
    location: 'Hyderabad, Telangana',
    workMode: 'On-site',
    skills: ['Recruitment', 'Employee Relations', 'HR Policies', 'Performance Management', 'Onboarding'],
    track: 'hr',
    description:
      'Own end-to-end hiring and employee relations for the Mzobs internal team — from sourcing to onboarding to policy — as the team scales. Looking for an experienced HR professional who can run HR independently and grow into a leadership role. Final CTC will be discussed and finalized during the interview based on your experience.',
    benefits: [
      'Health insurance',
      'Performance-based bonus',
      'Fixed weekday schedule',
      'Growth into a leadership role as the team scales',
    ],
  },
]

async function run() {
  await connectDB(env.mongoUri)

  let company = await Company.findOne({ name: 'Mzobs' })
  if (!company) {
    company = await Company.create({
      name: 'Mzobs',
      logo: '',
      industry: 'Staffing & HR Tech',
      hq: 'Hyderabad, Telangana',
      locations: ['Hyderabad'],
      website: 'mzobs.com',
      about:
        "Mzobs connects verified job seekers with employers who need them — every profile and every requirement reviewed by a real person before it goes live.",
      verificationStatus: 'verified',
      submittedOn: new Date(),
      verifiedOn: new Date(),
      verifiedBy: 'Mzobs Compliance',
    })
    console.log(`Created company: ${company.name} (${company.id})`)
  } else {
    console.log(`Company already exists: ${company.name} (${company.id})`)
  }

  const staff = await StaffUser.findOne({ email: env.seedStaffEmail?.toLowerCase() }) || (await StaffUser.findOne({}))
  if (staff) console.log(`Attributing postings to staff: ${staff.name} (${staff.id})`)
  else console.log('No StaffUser found — postings will have postedByStaff: null')

  const now = new Date()
  const deadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  for (const jobData of JOBS) {
    const existing = await Job.findOne({ company: company._id, title: jobData.title })
    if (existing) {
      console.log(`Skipped (already exists): ${jobData.title} (${existing.id})`)
      continue
    }
    const job = await Job.create({
      ...jobData,
      company: company._id,
      postedByStaff: staff?._id ?? null,
      deadline,
      status: 'sourcing',
      visibleToCandidates: true,
      submittedOn: now,
      postedOn: now,
      updatedOn: now,
    })
    console.log(`Created job: ${job.title} (${job.id})`)
  }

  console.log('Done.')
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
