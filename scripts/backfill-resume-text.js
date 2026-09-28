// One-off backfill — extracts searchable text for resumes uploaded before
// resume.text existed. Safe to re-run: only touches resumes with no text yet.
//   node scripts/backfill-resume-text.js            (all missing)
//   node scripts/backfill-resume-text.js --dry-run  (just count)
import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import mongoose from 'mongoose'
import { downloadObject, isS3Configured } from '../src/utils/s3.js'
import { extractResumeText } from '../src/utils/resumeText.js'
import { sniffFileType } from '../src/utils/fileValidation.js'

const dryRun = process.argv.includes('--dry-run')
const UPLOADS_ROOT = path.join(process.cwd(), 'uploads')

await mongoose.connect(process.env.MONGO_URI)
const employees = mongoose.connection.collection('employees')
const filter = { 'resume.status': 'verified', $or: [{ 'resume.text': { $exists: false } }, { 'resume.text': '' }] }
const total = await employees.countDocuments(filter)
console.log(`${total} resume(s) without text${dryRun ? ' (dry run — nothing written)' : ''}`)

let done = 0
let empty = 0
let failed = 0
if (!dryRun) {
  for await (const e of employees.find(filter, { projection: { 'resume.s3Key': 1, 'resume.url': 1, 'resume.file': 1 } })) {
    try {
      let buffer = null
      if (e.resume?.s3Key && isS3Configured()) buffer = await downloadObject(e.resume.s3Key)
      else if (e.resume?.url) {
        const resolved = path.join(UPLOADS_ROOT, e.resume.url.replace(/^\/?uploads\/?/, ''))
        if (resolved.startsWith(UPLOADS_ROOT + path.sep)) buffer = await fs.readFile(resolved)
      }
      const type = buffer ? sniffFileType(buffer) : null
      const text = type ? await extractResumeText(buffer, type.ext) : ''
      if (!text) empty++
      // Store a marker-free empty string for unreadable files; they are retried on the next run.
      await employees.updateOne({ _id: e._id }, { $set: { 'resume.text': text } })
      if (text) done++
    } catch (err) {
      failed++
      console.warn(`employee ${e._id}: ${err.message}`)
    }
  }
  console.log(`extracted: ${done}, no readable text (scanned/.doc/.rtf): ${empty}, failed: ${failed}`)
}
await mongoose.disconnect()
