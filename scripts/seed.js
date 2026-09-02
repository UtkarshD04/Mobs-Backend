import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { connectDB } from '../src/config/db.js'
import { env } from '../src/config/env.js'
import Company from '../src/models/Company.js'
import User from '../src/models/User.js'
import StaffUser from '../src/models/StaffUser.js'
import Job from '../src/models/Job.js'

async function seed() {
  await connectDB(env.mongoUri)

  let company = await Company.findOne({ name: env.seedCompanyName })
  if (!company) {
    company = await Company.create({
      name: env.seedCompanyName,
      logo: 'ST',
      industry: 'Enterprise SaaS',
      size: '501-1000 employees',
      founded: '2014',
      website: 'solacetech.com',
      linkedin: 'linkedin.com/company/solacetech',
      about: 'Solace Technologies builds workflow automation software for mid-market enterprises.',
      hq: 'Bengaluru, Karnataka',
      locations: ['Bengaluru', 'Pune', 'Remote'],
      verificationStatus: 'verified',
      submittedOn: new Date(),
      verifiedOn: new Date(),
      verifiedBy: 'Mzobs Compliance',
    })
    console.log(`Created company: ${company.name} (${company.id})`)
  } else {
    console.log(`Company already exists: ${company.name} (${company.id})`)
  }

  let admin = await User.findOne({ email: env.seedAdminEmail.toLowerCase() })
  if (!admin) {
    const passwordHash = await bcrypt.hash(env.seedAdminPassword, 10)
    admin = await User.create({
      company: company._id,
      name: 'Rhea Kapoor',
      email: env.seedAdminEmail,
      passwordHash,
      role: 'Admin',
      status: 'active',
    })
    console.log(`Created admin user: ${admin.email}`)
  } else {
    console.log(`Admin user already exists: ${admin.email}`)
  }

  let staff = await StaffUser.findOne({ email: env.seedStaffEmail.toLowerCase() })
  if (!staff) {
    const staffPasswordHash = await bcrypt.hash(env.seedStaffPassword, 10)
    staff = await StaffUser.create({
      name: env.seedStaffName,
      email: env.seedStaffEmail,
      passwordHash: staffPasswordHash,
      role: 'Operations Manager',
      accessLevel: 'admin',
      status: 'active',
    })
    console.log(`Created staff user: ${staff.email}`)
  } else {
    console.log(`Staff user already exists: ${staff.email}`)
  }

  let job = await Job.findOne({ company: company._id, title: 'Frontend Engineer' })
  if (!job) {
    job = await Job.create({
      company: company._id,
      createdBy: admin._id,
      title: 'Frontend Engineer',
      department: 'Engineering',
      employmentType: 'Full-time',
      experienceMin: 2,
      experienceMax: 5,
      salaryMin: 800000,
      salaryMax: 1400000,
      vacancies: 2,
      location: 'Bengaluru',
      workMode: 'Hybrid',
      skills: ['React', 'JavaScript', 'CSS'],
      track: 'tech',
      description: 'Build and ship user-facing features across our web products, working closely with design and backend teams.',
      benefits: ['Health insurance', 'Flexible hours', 'Learning budget'],
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      status: 'sourcing',
      visibleToCandidates: true,
      postedOn: new Date(),
    })
    console.log(`Created job opening: ${job.title} (${job.id})`)
  } else {
    console.log(`Job opening already exists: ${job.title} (${job.id})`)
  }

  console.log('\nSeed complete.')
  console.log(`  Employer login email:    ${env.seedAdminEmail}`)
  console.log(`  Employer login password: ${env.seedAdminPassword}`)
  console.log(`  Staff login email:       ${env.seedStaffEmail}`)
  console.log(`  Staff login password:    ${env.seedStaffPassword}`)
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
