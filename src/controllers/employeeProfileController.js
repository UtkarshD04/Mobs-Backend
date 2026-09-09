import { asyncHandler } from '../utils/asyncHandler.js'
import { serializeResumeSubdoc, serializeResumeHistory } from '../utils/resumeAccess.js'

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
