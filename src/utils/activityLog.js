import Activity from '../models/Activity.js'

export function logActivity(companyId, text, tone = 'navy') {
  return Activity.create({ company: companyId, text, tone })
}
