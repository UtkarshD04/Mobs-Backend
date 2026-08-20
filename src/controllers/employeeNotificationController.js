import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import EmployeeNotification from '../models/EmployeeNotification.js'

function toNotification(n) {
  return {
    id: n._id.toString(),
    category: n.category,
    title: n.title,
    body: n.body,
    time: formatRelative(n.createdAt),
    unread: n.unread,
  }
}

export const listNotifications = asyncHandler(async (req, res) => {
  const notifications = await EmployeeNotification.find({ employee: req.employee._id }).sort({ createdAt: -1 })
  res.json(notifications.map(toNotification))
})

export const markAsRead = asyncHandler(async (req, res) => {
  await EmployeeNotification.updateOne({ _id: req.params.id, employee: req.employee._id }, { unread: false })
  res.json({ success: true })
})

export const markAllRead = asyncHandler(async (req, res) => {
  await EmployeeNotification.updateMany({ employee: req.employee._id }, { unread: false })
  res.json({ success: true })
})
