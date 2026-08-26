import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import StaffNotification from '../models/StaffNotification.js'
import Employee from '../models/Employee.js'
import Company from '../models/Company.js'
import StaffUser from '../models/StaffUser.js'
import { sendPush } from '../utils/push.js'
import { notifyEmployee } from '../utils/notifyEmployee.js'
import { notifyEmployer } from '../utils/notifyEmployer.js'
import { notifyStaff } from '../utils/notifyStaff.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'

// Any staff member (admin or ops) can manually message any employee, employer
// or fellow staff member — a lightweight recipient picker + send, separate
// from the heavier admin-only company/team management endpoints.
const AUDIENCES = {
  employee: { Model: Employee, notify: notifyEmployee, label: 'candidate', searchFields: ['name', 'email'] },
  employer: { Model: Company, notify: notifyEmployer, label: 'company', searchFields: ['name'] },
  staff: { Model: StaffUser, notify: notifyStaff, label: 'staff member', searchFields: ['name', 'email'] },
}

export const listRecipients = asyncHandler(async (req, res) => {
  const { audience, search } = req.query
  const config = AUDIENCES[audience]
  if (!config) return res.status(400).json({ message: 'audience must be employee, employer or staff' })

  const query = {}
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = config.searchFields.map((field) => ({ [field]: regex }))
  }

  const recipients = await config.Model.find(query).select('name email').limit(50)
  res.json(recipients.map((r) => ({ id: r._id.toString(), name: r.name, email: r.email ?? '' })))
})

export const sendNotification = asyncHandler(async (req, res) => {
  const { audience, recipientIds, broadcast, title, body } = req.body ?? {}
  const config = AUDIENCES[audience]
  if (!config) return res.status(400).json({ message: 'audience must be employee, employer or staff' })
  if (!title || !body) return res.status(400).json({ message: 'title and body are required' })
  if (!broadcast && (!Array.isArray(recipientIds) || !recipientIds.length)) {
    return res.status(400).json({ message: 'recipientIds is required unless broadcast is true' })
  }

  const query = broadcast ? {} : { _id: { $in: recipientIds } }
  const recipients = await config.Model.find(query)
  await Promise.all(recipients.map((r) => config.notify(r, { category: 'system', title, body })))

  await logStaffActivity(
    `${req.staff.name} sent a notification to ${recipients.length} ${config.label}${recipients.length === 1 ? '' : 's'}`,
    'gold'
  )

  res.status(201).json({ sent: recipients.length })
})

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
