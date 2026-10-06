import User from '../models/User.js'
import Company from '../models/Company.js'
import Job from '../models/Job.js'
import SupportTicket from '../models/SupportTicket.js'
import { logStaffActivity } from './staffActivityLog.js'

export class LastAdminError extends Error {
  constructor() {
    super('You are the only admin of this company and your team still has members. Remove them, or make another member an admin, before deleting your account.')
    this.name = 'LastAdminError'
  }
}

// Play Store account-deletion policy, employer side. Removes the person's own record (name, email,
// phone, push tokens, support tickets). When they are the last user of the company, the company is
// closed as well: open jobs are closed, its profile is cleared and it is blocked so nobody can sign
// in to it again. Payments, subscriptions, invoices and the hiring trail (unlocks, interviews,
// offers) are kept for tax and audit purposes, as the privacy policy discloses.
export async function deleteEmployerAccount(user) {
  const companyId = user.company
  const others = await User.countDocuments({ company: companyId, _id: { $ne: user._id } })
  if (others > 0 && user.role === 'Admin') {
    const otherAdmins = await User.countDocuments({ company: companyId, _id: { $ne: user._id }, role: 'Admin', status: 'active' })
    if (otherAdmins === 0) throw new LastAdminError()
  }

  await SupportTicket.deleteMany({ user: user._id })
  await user.deleteOne()

  if (others === 0) {
    const company = await Company.findById(companyId)
    if (company) {
      await Job.updateMany({ company: companyId, status: { $nin: ['closed', 'archived'] } }, { $set: { status: 'closed', visibleToCandidates: false } })
      Object.assign(company, {
        logo: '',
        about: '',
        website: '',
        linkedin: '',
        hq: '',
        locations: [],
        hiringContacts: [],
        blocked: true,
        blockedOn: new Date(),
        blockedBy: 'Account deleted by employer',
        blockReason: 'The employer deleted their account.',
      })
      await company.save()
      await logStaffActivity(`Employer account deleted — ${company.name}`, 'gold').catch(() => {})
    }
  }
}
