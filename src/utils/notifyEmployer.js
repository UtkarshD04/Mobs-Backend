import Notification from '../models/Notification.js'
import User from '../models/User.js'
import { sendPush } from './push.js'

// Notification.company is the recipient unit — every seat at that company
// shares the one feed — but push tokens live per-User, so a single
// notification doc fans out to every logged-in seat at the company.
export async function notifyEmployer(company, { category, title, body }) {
  const notification = await Notification.create({ company: company._id, category, title, body })
  const users = await User.find({ company: company._id })
  await Promise.all(users.map((user) => sendPush(user, { title: notification.title, body: notification.body })))
  return notification
}
