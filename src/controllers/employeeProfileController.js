import { asyncHandler } from '../utils/asyncHandler.js'
import { serializeResumeSubdoc, serializeResumeHistory } from '../utils/resumeAccess.js'
import { deleteEmployeeAccount } from '../utils/accountDeletion.js'

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
