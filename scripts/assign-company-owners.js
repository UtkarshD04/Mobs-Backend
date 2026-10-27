// One-off, idempotent: gives every company that has no Owner yet one, by promoting its earliest-created active Admin.
// Until this is run nothing breaks (Admins keep full access); it only lets an Owner be protected from Admins.
//   node scripts/assign-company-owners.js            # dry run
//   node scripts/assign-company-owners.js --apply
import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../src/models/User.js'

const apply = process.argv.includes('--apply')
await mongoose.connect(process.env.MONGO_URI)
const companies = await User.distinct('company')
let promoted = 0
for (const company of companies) {
  if (await User.exists({ company, role: 'Owner' })) continue
  const admin = await User.findOne({ company, role: 'Admin', status: { $ne: 'disabled' } }).sort({ createdAt: 1 })
  if (!admin) continue
  console.log(`${apply ? 'Promoting' : 'Would promote'} ${admin.email} to Owner (company ${company})`)
  if (apply) await User.updateOne({ _id: admin._id }, { role: 'Owner' })
  promoted += 1
}
console.log(`${promoted} compan${promoted === 1 ? 'y' : 'ies'} ${apply ? 'updated' : 'would be updated'}.`)
await mongoose.disconnect()
