import 'dotenv/config'
import { connectDB, disconnectDB } from '../src/config/db.js'
import { env } from '../src/config/env.js'
import StaffUser from '../src/models/StaffUser.js'

// One-time migration: staff accounts created before the admin/staff split
// had full access. Grandfather all of them into accessLevel: 'admin' so
// nobody loses access on deploy. New hires default to 'staff' going forward.
async function main() {
  await connectDB(env.mongoUri)
  const result = await StaffUser.updateMany({}, { $set: { accessLevel: 'admin' } })
  console.log(`Promoted ${result.modifiedCount} existing staff account(s) to admin.`)
  await disconnectDB()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
