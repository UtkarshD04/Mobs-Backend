import 'dotenv/config'
import { connectDB } from '../src/config/db.js'
import { env } from '../src/config/env.js'
import Job from '../src/models/Job.js'
import Company from '../src/models/Company.js'

// HR Manager's pay depends on interview/experience rather than a fixed
// range — salaryMin/salaryMax 0/0 is the sentinel toLatestJobSummary() and
// fmtSalaryRange() both treat as "show negotiable text, not a number".
async function run() {
  await connectDB(env.mongoUri)
  const company = await Company.findOne({ name: 'Mzobs' })
  const job = await Job.findOneAndUpdate(
    { company: company._id, title: 'HR Manager' },
    { salaryMin: 0, salaryMax: 0, updatedOn: new Date() },
    { new: true }
  )
  console.log(job ? `Updated: ${job.title} (${job.id}) salaryMin=${job.salaryMin} salaryMax=${job.salaryMax}` : 'Job not found')
  process.exit(0)
}
run().catch((e) => {
  console.error(e)
  process.exit(1)
})
