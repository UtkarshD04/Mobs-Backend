import { asyncHandler } from '../utils/asyncHandler.js'

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

export const getProfile = asyncHandler(async (req, res) => {
  res.json(req.employee)
})

export const updateProfile = asyncHandler(async (req, res) => {
  const input = pickInput(req.body ?? {})
  if (input.name !== undefined && !input.name.trim()) {
    return res.status(400).json({ message: 'name is required' })
  }

  Object.assign(req.employee, input)
  await req.employee.save()

  res.json(req.employee)
})
