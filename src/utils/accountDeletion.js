import path from 'path'
import { unlink } from 'fs/promises'
import Employee from '../models/Employee.js'
import SavedJob from '../models/SavedJob.js'
import RecentlyViewedJob from '../models/RecentlyViewedJob.js'
import MockInterview from '../models/MockInterview.js'
import Conversation from '../models/Conversation.js'
import Message from '../models/Message.js'
import EmployeeNotification from '../models/EmployeeNotification.js'
import NotificationPreference from '../models/NotificationPreference.js'
import Application from '../models/Application.js'
import SupportTicket from '../models/SupportTicket.js'
import Candidate from '../models/Candidate.js'
import ResumeAccessLog from '../models/ResumeAccessLog.js'
import { deleteObject, isS3Configured } from './s3.js'
import { logger } from '../config/logger.js'

// Play Store's Account Deletion policy requires every personal record tied
// to the account to be removed on request, with only "legitimate, disclosed"
// exceptions — here that's the employer-facing hiring trail (Candidate,
// ResumeAccessLog, Payment): an employer already paid a credit or scheduled
// an interview against that record, so it's anonymized and kept for their
// billing/audit history instead of deleted outright, as disclosed in the
// privacy policy. Payment itself carries no PII beyond an employee id ref,
// so it's left untouched (also required for GST/tax record-keeping).
async function deleteResumeObjects(employee) {
  if (!isS3Configured()) return
  const keys = [employee.resume?.s3Key, ...(employee.resumeHistory ?? []).map((r) => r.s3Key)].filter(Boolean)
  for (const key of keys) {
    try {
      await deleteObject(key)
    } catch (err) {
      logger.error({ err, key }, 'Failed to delete resume object during account deletion')
    }
  }
}

// Same as deleteResumeObjects, for a pre-S3-migration resume that only has
// a legacy static `/uploads/...` path (no s3Key) — otherwise deleting the
// account would leave that file behind on disk forever with nothing left
// referencing it. Same path-containment check as fileAccessController.js,
// since these paths ultimately come from the same stored `url` field.
const UPLOADS_ROOT = path.join(process.cwd(), 'uploads')

async function deleteLegacyResumeFiles(employee) {
  const urls = [employee.resume?.url, ...(employee.resumeHistory ?? []).map((r) => r.url)].filter(Boolean)
  for (const url of urls) {
    const resolved = path.join(UPLOADS_ROOT, url.replace(/^\/?uploads\/?/, ''))
    if (resolved !== UPLOADS_ROOT && !resolved.startsWith(UPLOADS_ROOT + path.sep)) continue
    try {
      await unlink(resolved)
    } catch (err) {
      if (err.code !== 'ENOENT') logger.error({ err, url }, 'Failed to delete legacy resume file during account deletion')
    }
  }
}

export async function deleteEmployeeAccount(employeeId) {
  const employee = await Employee.findById(employeeId).select('+resume.s3Key +resumeHistory.s3Key')
  if (!employee) return false

  await deleteResumeObjects(employee)
  await deleteLegacyResumeFiles(employee)

  const conversationIds = await Conversation.find({ employee: employee._id }).distinct('_id')
  await Promise.all([
    Message.deleteMany({ conversation: { $in: conversationIds } }),
    Conversation.deleteMany({ employee: employee._id }),
    SavedJob.deleteMany({ employee: employee._id }),
    RecentlyViewedJob.deleteMany({ employee: employee._id }),
    MockInterview.deleteMany({ employee: employee._id }),
    EmployeeNotification.deleteMany({ employee: employee._id }),
    NotificationPreference.deleteMany({ employee: employee._id }),
    Application.deleteMany({ employee: employee._id }),
    SupportTicket.deleteMany({ employee: employee._id, source: 'employee' }),
  ])

  // Anonymize rather than delete: an employer may already hold a paid
  // CandidateUnlock/Interview/Offer against this row — those stay intact,
  // just stripped of anything that identifies the person.
  await Candidate.updateMany(
    { employee: employee._id },
    {
      $set: {
        employee: null,
        name: 'Deleted candidate',
        email: '',
        phone: '',
        headline: '',
        location: '',
        skills: [],
        education: [],
        projects: [],
        workHistory: [],
        portfolioLink: '',
      },
    }
  )
  await ResumeAccessLog.updateMany({ employee: employee._id }, { $set: { employee: null } })

  await employee.deleteOne()
  return true
}
