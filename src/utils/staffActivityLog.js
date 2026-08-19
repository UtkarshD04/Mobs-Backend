import StaffActivity from '../models/StaffActivity.js'

export function logStaffActivity(text, tone = 'navy') {
  return StaffActivity.create({ text, tone })
}
