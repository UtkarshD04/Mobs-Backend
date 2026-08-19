import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { connectDB } from '../src/config/db.js'
import { env } from '../src/config/env.js'
import Company from '../src/models/Company.js'
import User from '../src/models/User.js'
import StaffUser from '../src/models/StaffUser.js'

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
      status: 'active',
    })
    console.log(`Created staff user: ${staff.email}`)
  } else {
    console.log(`Staff user already exists: ${staff.email}`)
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
