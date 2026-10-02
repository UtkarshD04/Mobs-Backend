import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import PlacementAssociate, { ASSOCIATE_STATUSES } from '../models/PlacementAssociate.js'
import { nextSequence } from '../models/Counter.js'
import { formatAssociateCode, ASSOCIATE_CODE_COUNTER } from '../utils/associateCode.js'
import { associateWelcomeEmail } from '../utils/associateWelcomeEmail.js'
import { sendMail } from '../utils/mailer.js'
import { logger } from '../config/logger.js'

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const listAssociates = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const query = {}

  if (typeof status === 'string' && ASSOCIATE_STATUSES.includes(status)) query.status = status
  if (typeof search === 'string' && search.trim()) {
    const regex = new RegExp(escapeRegex(search.trim()), 'i')
    query.$or = [{ companyName: regex }, { contactName: regex }, { email: regex }, { city: regex }, { phone: regex }, { code: regex }]
  }

  const { data, page, limit, total } = await paginate(PlacementAssociate, query, paginationParams(req), { sort: { createdAt: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const associateStats = asyncHandler(async (_req, res) => {
  const rows = await PlacementAssociate.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  const stats = Object.fromEntries(ASSOCIATE_STATUSES.map((s) => [s, 0]))
  let total = 0
  for (const r of rows) {
    if (r._id in stats) stats[r._id] = r.count
    total += r.count
  }
  res.json({ ...stats, total })
})

export const updateAssociate = asyncHandler(async (req, res) => {
  const { status, notes } = req.body ?? {}
  if (status !== undefined && !ASSOCIATE_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' })
  if (notes !== undefined && typeof notes !== 'string') return res.status(400).json({ message: 'Invalid notes' })

  const associate = await PlacementAssociate.findById(req.params.id)
  if (!associate) return res.status(404).json({ message: 'Associate request not found' })

  if (status !== undefined) associate.status = status
  if (notes !== undefined) associate.notes = notes
  associate.reviewedBy = req.staff.name
  associate.reviewedAt = new Date()
  await associate.save()

  // The associate code (MZ2601, MZ2602 …) is issued the first time they're Onboarded, and only once.
  // The conditional update means that if two staff members do this at the same moment, one code wins.
  let issued = false
  if (associate.status === 'Onboarded' && !associate.code) {
    const code = formatAssociateCode(await nextSequence(ASSOCIATE_CODE_COUNTER))
    const claimed = await PlacementAssociate.updateOne({ _id: associate._id, code: { $exists: false } }, { $set: { code, codeIssuedOn: new Date() } })
    issued = claimed.modifiedCount === 1
  }

  // Re-read so the response always carries the stored code, even when another request won the race.
  const fresh = await PlacementAssociate.findById(associate._id)

  if (issued) {
    await logStaffActivity(`Placement associate ${fresh.companyName} onboarded — code ${fresh.code}`, 'green')
    // Best effort: a mail problem must never undo or hide the onboarding itself.
    try {
      await sendMail({ to: fresh.email, ...associateWelcomeEmail({ contactName: fresh.contactName, companyName: fresh.companyName, code: fresh.code }) })
    } catch (err) {
      logger.warn({ err, associate: fresh.id }, 'Failed to send associate welcome email')
    }
  } else if (status !== undefined) {
    await logStaffActivity(`Placement associate ${fresh.companyName} marked ${fresh.status.toLowerCase()}`, 'gold')
  }
  res.json(fresh)
})
