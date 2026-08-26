import StaffNotification from '../models/StaffNotification.js'
import { sendPush } from './push.js'

export async function notifyStaff(staff, { category, title, body }) {
  const notification = await StaffNotification.create({ staff: staff._id, category, title, body })
  await sendPush(staff, { title: notification.title, body: notification.body })
  return notification
}
