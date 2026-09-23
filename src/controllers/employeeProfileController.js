import { asyncHandler } from '../utils/asyncHandler.js'
import { serializeResumeSubdoc, serializeResumeHistory } from '../utils/resumeAccess.js'
import { deleteEmployeeAccount } from '../utils/accountDeletion.js'
import { checkPhoneToken } from '../utils/phoneToken.js'

const PROFILE_FIELDS = [
  'name',
  'phone',
  'dob',
  'gender',
  'maritalStatus',
  'currentCity',
  'relocationOk',
  'currentCompany',
  'designation',
  'experienceYears',
  'currentCtc',
  'noticePeriod',
  'interests',
  'preferredRole',
  'expectedSalaryMin',
  'expectedSalaryMax',
  'preferredLocations',
  'workModePreference',
  'jobTypePreference',
  'openToOpportunities',
  'jobAlertsEnabled',
  'skills',
  'education',
  'projects',
  'workHistory',
  'portfolioLink',
  'linkedin',
  'github',
  'resumeHeadline',
  'experience',
  'graduation',
  'state',
  'pincode',
]

function pickInput(body) {
  const input = {}
  for (const field of PROFILE_FIELDS) {
    if (body[field] !== undefined) input[field] = body[field]
  }
  return input
}

// req.employee carries resume.s3Key/resumeHistory.s3Key (selected in
// requireEmployeeAuth) purely so this can mint a fresh access link — the
// key itself must never reach the client.
function serializeProfile(employee) {
  const json = employee.toJSON()
  json.resume = serializeResumeSubdoc(employee.resume, 'employee-resume')
  json.resumeHistory = serializeResumeHistory(employee.resumeHistory, 'employee-resume')
  json.hasPassword = !!employee.passwordHash
  delete json.passwordHash
  return json
}

export const getProfile = asyncHandler(async (req, res) => {
  res.json(serializeProfile(req.employee))
})

export const updateProfile = asyncHandler(async (req, res) => {
  const input = pickInput(req.body ?? {})
  if (input.name !== undefined && !input.name.trim()) {
    return res.status(400).json({ message: 'name is required' })
  }

  // Changing the phone number needs a freshly-verified OTP token for that
  // exact number — otherwise anyone could silently swap the contact number
  // and take over notifications/recovery for the account.
  if (input.phone !== undefined && input.phone.trim() !== req.employee.phone) {
    const { phoneToken } = req.body ?? {}
    if (typeof phoneToken !== 'string' || !checkPhoneToken(phoneToken, input.phone.trim())) {
      return res.status(400).json({ message: 'Verify the new number with an OTP before saving it.', code: 'PHONE_NOT_VERIFIED' })
    }
  }

  Object.assign(req.employee, input)
  await req.employee.save()

  res.json(serializeProfile(req.employee))
})

// Self-service delete — Play Store's Account Deletion policy requires this
// in-app path alongside the public one (accountDeletionController.js);
// both share the same cascade in utils/accountDeletion.js, as does the
// staff-triggered deleteEmployee in staffEmployeeAccountController.js.
export const deleteAccount = asyncHandler(async (req, res) => {
  const id = req.employee._id
  await deleteEmployeeAccount(id)
  res.json({ id: id.toString() })
})

// The mandatory "complete your profile" step that follows the ₹99 payment. Saves
// whatever was sent, then checks the details a recruiter needs before the profile
// counts as complete. Only paid accounts can call it, so an unpaid signup is never
// asked for (or pretends to have finished) the full profile.
const isText = (v) => typeof v === 'string' && v.trim().length > 0
const nonEmptyList = (v) => Array.isArray(v) && v.some((x) => isText(String(x ?? '')))

export function missingProfileFields(e) {
  const missing = []
  const need = (ok, label) => {
    if (!ok) missing.push(label)
  }
  need(isText(e.name), 'name')
  need(/^[6-9]\d{9}$/.test(String(e.phone ?? '').replace(/^\+?91/, '').replace(/\D/g, '')), 'mobile number')
  need(isText(e.dob), 'date of birth')
  need(isText(e.gender), 'gender')
  need(isText(e.currentCity), 'current city')
  need(isText(e.state), 'state')
  need(/^\d{6}$/.test(String(e.pincode ?? '').trim()), 'pincode')
  if (e.experience === 'experienced') {
    need(isText(e.currentCompany), 'current company')
    need(isText(e.designation), 'designation')
    need(Number(e.experienceYears) > 0, 'total experience')
  }
  const edu = Array.isArray(e.education) ? e.education[0] : null
  need(edu && isText(edu.degree) && isText(edu.institute) && isText(edu.year), 'education (degree, institute and year)')
  need(nonEmptyList(e.skills), 'at least one skill')
  need(isText(e.preferredRole), 'preferred role')
  need(nonEmptyList(e.preferredLocations), 'preferred location')
  need(isText(e.resumeHeadline), 'resume headline')
  return missing
}

export const completeProfile = asyncHandler(async (req, res) => {
  const employee = req.employee
  if (!employee.isPremium) {
    return res.status(403).json({ message: 'Activate placement support to complete your profile.', code: 'PREMIUM_REQUIRED' })
  }

  const input = pickInput(req.body ?? {})
  if (input.name !== undefined && !String(input.name).trim()) {
    return res.status(400).json({ message: 'name is required' })
  }
  Object.assign(employee, input)

  const missing = missingProfileFields(employee)
  if (missing.length) {
    return res.status(400).json({ message: `Please fill in: ${missing.join(', ')}.`, code: 'PROFILE_INCOMPLETE', missing })
  }

  employee.profileSetupPending = false
  employee.profileCompletedAt = employee.profileCompletedAt ?? new Date()
  await employee.save()

  res.json(serializeProfile(employee))
})
