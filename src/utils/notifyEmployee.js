import EmployeeNotification from '../models/EmployeeNotification.js'
import NotificationPreference from '../models/NotificationPreference.js'
import { sendPush } from './push.js'
import { employeeNotificationUrl } from './notificationLinks.js'

export async function notifyEmployee(employee, { category, title, body, dedupeKey }) {
  // No preference doc yet defaults to in-app on (see NotificationPreference's
  // schema defaults) — only an explicit opt-out should suppress this.
  const prefs = await NotificationPreference.findOne({ employee: employee._id }).select(`${category}.inApp`)
  if (prefs && prefs[category]?.inApp === false) return null

  // With a dedupeKey a retry never creates (or pushes) a second copy: the existing one is returned.
  if (dedupeKey) {
    const existing = await EmployeeNotification.findOne({ dedupeKey })
    if (existing) return existing
  }
  let notification
  try {
    notification = await EmployeeNotification.create({ employee: employee._id, category, title, body, ...(dedupeKey ? { dedupeKey } : {}) })
  } catch (err) {
    if (dedupeKey && err?.code === 11000) return EmployeeNotification.findOne({ dedupeKey })
    throw err
  }
  // `data` rides along with the push so the app can open the right screen when it's tapped: `url` for the web app, `category`/`notificationId` for the mobile app.
  await sendPush(employee, { title: notification.title, body: notification.body, data: { url: employeeNotificationUrl(category), category, notificationId: notification._id.toString() } })
  return notification
}
