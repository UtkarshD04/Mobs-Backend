// One-off manual script — run from Backend/ with:
//   node scripts/reset-employee-password.js <email> <new-password>
import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const [, , email, newPassword] = process.argv
if (!email || !newPassword) {
  console.error('Usage: node scripts/reset-employee-password.js <email> <new-password>')
  process.exit(1)
}

await mongoose.connect(process.env.MONGO_URI)
const passwordHash = await bcrypt.hash(newPassword, 10)
const result = await mongoose.connection
  .collection('employees')
  .updateOne({ email: email.toLowerCase().trim() }, { $set: { passwordHash } })

console.log('matched:', result.matchedCount, 'modified:', result.modifiedCount)
await mongoose.disconnect()
