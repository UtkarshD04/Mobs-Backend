import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import { notifyEmployee } from '../utils/notifyEmployee.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import Employee from '../models/Employee.js'
import PremiumServiceRequest, { OPEN_SERVICE_REQUEST_STATUSES, SERVICE_REQUEST_STATUSES } from '../models/PremiumServiceRequest.js'
import { PREMIUM_SERVICES, publicPlan } from '../config/premiumPlan.js'

const SERVICE_BY_KEY = new Map(PREMIUM_SERVICES.map((s) => [s.key, s]))
const serviceLabel = (key) => SERVICE_BY_KEY.get(key)?.label ?? key

// Which stage a request may move to next. Delivered and cancelled are final;
// "scheduled -> scheduled" is a reschedule.
const NEXT_STATUSES = {
  requested: ['scheduled', 'in_progress', 'delivered', 'cancelled'],
  scheduled: ['scheduled', 'in_progress', 'delivered', 'cancelled'],
  in_progress: ['scheduled', 'delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
}

const CANDIDATE_MESSAGES = {
  scheduled: (r) => `Your ${serviceLabel(r.service)} session is scheduled for ${r.scheduledFor.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })}.`,
  in_progress: (r) => `The MZOBS team has started working on your ${serviceLabel(r.service)}.`,
  delivered: (r) => `Your ${serviceLabel(r.service)} is ready. Open Premium services to see it.`,
  cancelled: (r) => `Your ${serviceLabel(r.service)} request was cancelled.`,
}

const isHttpUrl = (value) => {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
const clip = (value, max) => String(value ?? '').trim().slice(0, max)

// What the candidate may see — never the internal staff note.
function forCandidate(request) {
  const json = request.toJSON()
  delete json.staffNote
  return json
}

// GET /api/employee/subscription/plan — public. The plan comparison, fee,
// free application cap and requestable services.
export const getPlan = (req, res) => {
  res.set('Cache-Control', 'public, max-age=300')
  res.json(publicPlan())
}

// GET /api/employee/premium-services
export const listMyServiceRequests = asyncHandler(async (req, res) => {
  const requests = await PremiumServiceRequest.find({ employee: req.employee._id }).sort({ createdAt: -1 }).limit(200)
  res.json(requests.map(forCandidate))
})

// POST /api/employee/premium-services — Premium only, one open request per service.
export const createServiceRequest = asyncHandler(async (req, res) => {
  const { service, note, preferredTime } = req.body ?? {}
  if (!SERVICE_BY_KEY.has(service)) return res.status(400).json({ message: 'Choose a valid Premium service.' })
  if (!req.employee.isPremium) {
    return res.status(403).json({ message: 'Premium services are available on Mzobs Premium.', code: 'PREMIUM_REQUIRED' })
  }

  const open = await PremiumServiceRequest.exists({ employee: req.employee._id, service, status: { $in: OPEN_SERVICE_REQUEST_STATUSES } })
  if (open) return res.status(409).json({ message: 'You already have an open request for this service.', code: 'ALREADY_REQUESTED' })

  const request = await PremiumServiceRequest.create({
    employee: req.employee._id,
    service,
    note: clip(note, 1000),
    preferredTime: clip(preferredTime, 200),
    statusHistory: [{ status: 'requested', changedOn: new Date(), changedBy: 'employee' }],
  })

  await logStaffActivity(`${req.employee.name} requested ${serviceLabel(service)}`, 'gold')
  res.status(201).json(forCandidate(request))
})

// PATCH /api/employee/premium-services/:id/cancel — only before the team picks it up.
export const cancelMyServiceRequest = asyncHandler(async (req, res) => {
  const request = await PremiumServiceRequest.findOne({ _id: req.params.id, employee: req.employee._id })
  if (!request) return res.status(404).json({ message: 'Request not found' })
  if (request.status !== 'requested') {
    return res.status(409).json({ message: 'The team has already started on this request. Contact support to change it.' })
  }
  request.status = 'cancelled'
  request.statusHistory.push({ status: 'cancelled', changedOn: new Date(), changedBy: 'employee' })
  await request.save()
  res.json(forCandidate(request))
})

// GET /api/staff/premium-services?status=&service=&q=&page=&limit=
export const listServiceRequests = asyncHandler(async (req, res) => {
  const query = {}
  const status = String(req.query.status ?? '')
  if (status === 'open') query.status = { $in: OPEN_SERVICE_REQUEST_STATUSES }
  else if (SERVICE_REQUEST_STATUSES.includes(status)) query.status = status
  if (SERVICE_BY_KEY.has(req.query.service)) query.service = req.query.service

  const q = clip(req.query.q, 80)
  if (q) {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const ids = await Employee.find({ $or: [{ name: new RegExp(escaped, 'i') }, { email: new RegExp(escaped, 'i') }, { phone: new RegExp(escaped, 'i') }] }).distinct('_id')
    query.employee = { $in: ids }
  }

  const { data, page, limit, total } = await paginate(PremiumServiceRequest, query, paginationParams(req), {
    sort: { createdAt: -1 },
    populate: { path: 'employee', select: 'name email phone currentCity preferredRole' },
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

// GET /api/staff/premium-services/stats — counts per stage for the queue tabs.
export const serviceRequestStats = asyncHandler(async (req, res) => {
  const rows = await PremiumServiceRequest.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }])
  const byStatus = Object.fromEntries(SERVICE_REQUEST_STATUSES.map((s) => [s, 0]))
  rows.forEach((r) => (byStatus[r._id] = r.count))
  res.json({ byStatus, open: OPEN_SERVICE_REQUEST_STATUSES.reduce((n, s) => n + byStatus[s], 0) })
})

// PATCH /api/staff/premium-services/:id — move a request along the pipeline
// and/or update its details. The candidate is notified on every stage change.
export const updateServiceRequest = asyncHandler(async (req, res) => {
  const request = await PremiumServiceRequest.findById(req.params.id)
  if (!request) return res.status(404).json({ message: 'Request not found' })

  const body = req.body ?? {}
  const next = body.status

  if (body.scheduledFor !== undefined) {
    const when = body.scheduledFor ? new Date(body.scheduledFor) : null
    if (when && Number.isNaN(when.getTime())) return res.status(400).json({ message: 'scheduledFor must be a valid date' })
    request.scheduledFor = when
  }
  for (const field of ['meetingLink', 'deliverableLink']) {
    if (body[field] === undefined) continue
    const value = clip(body[field], 500)
    if (value && !isHttpUrl(value)) return res.status(400).json({ message: `${field} must be an http(s) link` })
    request[field] = value
  }
  if (body.candidateMessage !== undefined) request.candidateMessage = clip(body.candidateMessage, 2000)
  if (body.staffNote !== undefined) request.staffNote = clip(body.staffNote, 2000)
  if (body.assignedTo !== undefined) request.assignedTo = clip(body.assignedTo, 120)

  const statusChanged = next && (next !== request.status || next === 'scheduled')
  if (next && next !== request.status && !NEXT_STATUSES[request.status]?.includes(next)) {
    return res.status(409).json({ message: `A ${request.status.replace('_', ' ')} request can't be moved to ${String(next).replace('_', ' ')}.` })
  }
  if (next === 'scheduled' && !request.scheduledFor) return res.status(400).json({ message: 'Set a date and time to schedule this request.' })
  if (next === 'delivered' && !request.candidateMessage && !request.deliverableLink) {
    return res.status(400).json({ message: 'Add a message or a deliverable link for the candidate before marking it delivered.' })
  }

  if (statusChanged) {
    request.status = next
    request.statusHistory.push({ status: next, changedOn: new Date(), changedBy: req.staff.name })
    if (next === 'delivered') request.deliveredOn = new Date()
    if (!request.assignedTo) request.assignedTo = req.staff.name
  }

  await request.save()

  if (statusChanged) {
    const employee = await Employee.findById(request.employee)
    if (employee) {
      await notifyEmployee(employee, { category: 'training', title: serviceLabel(request.service), body: CANDIDATE_MESSAGES[next](request) })
    }
    await logStaffActivity(`${req.staff.name} moved a ${serviceLabel(request.service)} request to ${next.replace('_', ' ')}`, next === 'delivered' ? 'green' : 'navy')
  }

  await request.populate({ path: 'employee', select: 'name email phone currentCity preferredRole' })
  res.json(request)
})
