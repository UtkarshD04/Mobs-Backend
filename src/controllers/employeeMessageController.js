import { asyncHandler } from '../utils/asyncHandler.js'
import { formatRelative } from '../utils/formatDate.js'
import Conversation from '../models/Conversation.js'
import Message from '../models/Message.js'

// Every candidate gets a standing line to the Mzobs support desk — there's no
// "start a new conversation" flow in the portal, so a thread must already
// exist the first time a candidate opens Messages.
const DEFAULT_THREAD = { contactName: 'Mzobs Support', contactRole: 'Support', contactInitials: 'MS' }
const WELCOME_MESSAGE = 'Hi! Welcome to Mzobs. Let us know if you need anything.'

async function ensureDefaultThread(employeeId) {
  const existing = await Conversation.findOne({ employee: employeeId })
  if (existing) return

  const conversation = await Conversation.create({ employee: employeeId, ...DEFAULT_THREAD })
  await Message.create({ conversation: conversation._id, direction: 'in', text: WELCOME_MESSAGE, read: false })
}

export const listThreads = asyncHandler(async (req, res) => {
  await ensureDefaultThread(req.employee._id)

  const conversations = await Conversation.find({ employee: req.employee._id }).sort({ lastMessageAt: -1 })
  const threads = await Promise.all(
    conversations.map(async (c) => {
      const [last, unread] = await Promise.all([
        Message.findOne({ conversation: c._id }).sort({ createdAt: -1 }),
        Message.countDocuments({ conversation: c._id, direction: 'in', read: false }),
      ])
      return {
        id: c._id.toString(),
        name: c.contactName,
        role: c.contactRole,
        av: c.contactInitials,
        last: last?.text ?? '',
        time: formatRelative(last?.createdAt ?? c.createdAt),
        unread,
      }
    })
  )
  res.json(threads)
})

export const getThreadMessages = asyncHandler(async (req, res) => {
  const conversation = await Conversation.findOne({ _id: req.params.id, employee: req.employee._id })
  if (!conversation) return res.status(404).json({ message: 'Conversation not found' })

  await Message.updateMany({ conversation: conversation._id, direction: 'in', read: false }, { read: true })

  const messages = await Message.find({ conversation: conversation._id }).sort({ createdAt: 1 })
  res.json(messages.map((m) => ({ id: m._id.toString(), direction: m.direction, text: m.text, time: m.createdAt })))
})

export const sendMessage = asyncHandler(async (req, res) => {
  const text = (req.body?.text ?? '').trim()
  if (!text) return res.status(400).json({ message: 'text is required' })

  const conversation = await Conversation.findOne({ _id: req.params.id, employee: req.employee._id })
  if (!conversation) return res.status(404).json({ message: 'Conversation not found' })

  const message = await Message.create({ conversation: conversation._id, direction: 'out', text, read: true })
  conversation.lastMessageAt = message.createdAt
  await conversation.save()

  res.status(201).json({ id: message._id.toString(), direction: message.direction, text: message.text, time: message.createdAt })
})
