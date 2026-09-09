import { asyncHandler } from '../utils/asyncHandler.js'
import NotificationPreference from '../models/NotificationPreference.js'

const CATEGORIES = ['applications', 'resume', 'interviews', 'training', 'track', 'system']

async function getOrCreate(employeeId) {
  let prefs = await NotificationPreference.findOne({ employee: employeeId })
  if (!prefs) prefs = await NotificationPreference.create({ employee: employeeId })
  return prefs
}

export const getPreferences = asyncHandler(async (req, res) => {
  const prefs = await getOrCreate(req.employee._id)
  res.json(prefs)
})

export const updatePreferences = asyncHandler(async (req, res) => {
  const body = req.body ?? {}
  const prefs = await getOrCreate(req.employee._id)

  for (const category of CATEGORIES) {
    const input = body[category]
    if (!input || typeof input !== 'object') continue
    for (const channel of ['inApp', 'email', 'sms']) {
      if (typeof input[channel] === 'boolean') prefs[category][channel] = input[channel]
    }
  }

  await prefs.save()
  res.json(prefs)
})
