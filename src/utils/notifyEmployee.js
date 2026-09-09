import EmployeeNotification from '../models/EmployeeNotification.js'
import NotificationPreference from '../models/NotificationPreference.js'
import { sendPush } from './push.js'

export async function notifyEmployee(employee, { category, title, body }) {
  // No preference doc yet defaults to in-app on (see NotificationPreference's
  // schema defaults) — only an explicit opt-out should suppress this.
  const prefs = await NotificationPreference.findOne({ employee: employee._id }).select(`${category}.inApp`)
  if (prefs && prefs[category]?.inApp === false) return null

  const notification = await EmployeeNotification.create({ employee: employee._id, category, title, body })
  await sendPush(employee, { title: notification.title, body: notification.body })
  return notification
}
