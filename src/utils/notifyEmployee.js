import EmployeeNotification from '../models/EmployeeNotification.js'
import { sendPush } from './push.js'

export async function notifyEmployee(employee, { category, title, body }) {
  const notification = await EmployeeNotification.create({ employee: employee._id, category, title, body })
  await sendPush(employee, { title: notification.title, body: notification.body })
  return notification
}
