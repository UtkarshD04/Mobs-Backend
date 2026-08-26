import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import Notification from '../models/Notification.js'
import Candidate from '../models/Candidate.js'
import Employee from '../models/Employee.js'
import { sendPush } from '../utils/push.js'
import { notifyEmployee } from '../utils/notifyEmployee.js'

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
  const notifications = await Notification.find({ company: req.company._id }).sort({ createdAt: -1 })
  res.json(notifications.map(toNotification))
})

export const markAsRead = asyncHandler(async (req, res) => {
  await Notification.updateOne({ _id: req.params.id, company: req.company._id }, { unread: false })
  res.json({ success: true })
})

export const markAllRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ company: req.company._id }, { unread: false })
  res.json({ success: true })
})

export const sendTestPush = asyncHandler(async (req, res) => {
  const notification = await Notification.create({
    company: req.company._id,
    category: 'system',
    title: 'Test notification',
    body: `Hey ${req.user.name}, push notifications are working.`,
  })
  await sendPush(req.user, { title: notification.title, body: notification.body })
  res.status(201).json(toNotification(notification))
})

// HR can only message candidates Mzobs has actually shared with their own
// company — scoping every candidateId to req.company._id here (not just
// trusting the frontend) is what enforces that, same boundary listCandidates
// already relies on.
export const sendToCandidates = asyncHandler(async (req, res) => {
  const { candidateIds, title, body } = req.body ?? {}
  if (!title || !body) return res.status(400).json({ message: 'title and body are required' })
  if (!Array.isArray(candidateIds) || !candidateIds.length) {
    return res.status(400).json({ message: 'candidateIds is required' })
  }

  const candidates = await Candidate.find({ _id: { $in: candidateIds }, company: req.company._id, employee: { $ne: null } })
  const employees = await Employee.find({ _id: { $in: candidates.map((c) => c.employee) } })
  await Promise.all(employees.map((employee) => notifyEmployee(employee, { category: 'system', title, body })))

  res.status(201).json({ sent: employees.length })
})
