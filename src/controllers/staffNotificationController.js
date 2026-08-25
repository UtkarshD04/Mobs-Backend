import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import StaffNotification from '../models/StaffNotification.js'
import { sendPush } from '../utils/push.js'

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
  const notifications = await StaffNotification.find({ staff: req.staff._id }).sort({ createdAt: -1 })
  res.json(notifications.map(toNotification))
})

export const markAsRead = asyncHandler(async (req, res) => {
  await StaffNotification.updateOne({ _id: req.params.id, staff: req.staff._id }, { unread: false })
  res.json({ success: true })
})

export const markAllRead = asyncHandler(async (req, res) => {
  await StaffNotification.updateMany({ staff: req.staff._id }, { unread: false })
  res.json({ success: true })
})

export const sendTestPush = asyncHandler(async (req, res) => {
  const notification = await StaffNotification.create({
    staff: req.staff._id,
    category: 'system',
    title: 'Test notification',
    body: `Hey ${req.staff.name}, push notifications are working.`,
  })
  await sendPush(req.staff, { title: notification.title, body: notification.body })
  res.status(201).json(toNotification(notification))
})
