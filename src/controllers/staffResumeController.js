import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Employee from '../models/Employee.js'
import StaffUser from '../models/StaffUser.js'
import StaffNotification from '../models/StaffNotification.js'
import { sendPush } from '../utils/push.js'
import { notifyEmployee } from '../utils/notifyEmployee.js'

const STATUSES = ['pending', 'verified', 'changes', 'rejected']

const RESUME_DECISION_MESSAGES = {
  verified: 'Your resume has been verified by the Mzobs team.',
  changes: 'The Mzobs team requested changes to your resume — check the review notes and re-upload.',
  rejected: 'Your resume was not approved this time. Check the review notes for details.',
}

export const listResumeQueue = asyncHandler(async (req, res) => {
  const { status, search, assignedTo } = req.query
  const query = {}

  if (req.staff.accessLevel === 'admin') {
    if (assignedTo) query['resume.assignedTo'] = assignedTo === 'unassigned' ? null : assignedTo
  } else {
    query['resume.assignedTo'] = req.staff._id
  }

  if (status && status !== 'all') query['resume.status'] = status
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ name: regex }, { email: regex }, { skills: regex }]
  }

  const { data, page, limit, total } = await paginate(Employee, query, paginationParams(req), {
    sort: { 'resume.uploadedOn': -1 },
    select: '-passwordHash',
    populate: ['resume.assignedTo'],
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const stats = asyncHandler(async (req, res) => {
  const scope = req.staff.accessLevel === 'admin' ? { 'resume.status': { $ne: 'none' } } : { 'resume.assignedTo': req.staff._id }

  const byStatus = await Employee.aggregate([{ $match: scope }, { $group: { _id: '$resume.status', count: { $sum: 1 } } }])
  const counts = STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), { total: 0 })
  for (const row of byStatus) {
    if (!STATUSES.includes(row._id)) continue
    counts[row._id] = row.count
    counts.total += row.count
  }

  if (req.staff.accessLevel !== 'admin') return res.json(counts)

  const perStaff = await Employee.aggregate([
    { $match: { 'resume.assignedTo': { $ne: null } } },
    { $group: { _id: { staff: '$resume.assignedTo', status: '$resume.status' }, count: { $sum: 1 } } },
  ])
  const byStaffMap = new Map()
  for (const row of perStaff) {
    const key = row._id.staff.toString()
    if (!byStaffMap.has(key)) byStaffMap.set(key, STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), { staffId: key, total: 0 }))
    const entry = byStaffMap.get(key)
    if (STATUSES.includes(row._id.status)) entry[row._id.status] = row.count
    entry.total += row.count
  }
  const staffDocs = await StaffUser.find({ _id: { $in: [...byStaffMap.keys()] } }).select('name email')
  const staffLookup = new Map(staffDocs.map((s) => [s._id.toString(), s]))
  const perStaffBreakdown = [...byStaffMap.values()].map((entry) => ({
    ...entry,
    name: staffLookup.get(entry.staffId)?.name ?? 'Unknown',
    email: staffLookup.get(entry.staffId)?.email ?? '',
  }))

  res.json({ ...counts, unassigned: counts.total - perStaffBreakdown.reduce((sum, s) => sum + s.total, 0), perStaff: perStaffBreakdown })
})

async function notifyAssignment(staff, body) {
  const notification = await StaffNotification.create({ staff: staff._id, category: 'resumes', title: 'Resume assigned to you', body })
  await sendPush(staff, { title: notification.title, body: notification.body })
}

export const assign = asyncHandler(async (req, res) => {
  const { staffId } = req.body ?? {}
  if (!staffId) return res.status(400).json({ message: 'staffId is required' })

  const staff = await StaffUser.findById(staffId)
  if (!staff) return res.status(404).json({ message: 'Staff account not found' })

  const employee = await Employee.findById(req.params.employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })
  if (employee.resume.status === 'none') return res.status(400).json({ message: 'This candidate has not uploaded a resume yet' })

  employee.resume.assignedTo = staff._id
  employee.resume.assignedOn = new Date()
  employee.resume.assignedBy = req.staff._id
  await employee.save()
  await employee.populate('resume.assignedTo')

  await logStaffActivity(`${req.staff.name} assigned ${employee.name}'s resume to ${staff.name}`, 'navy')
  await notifyAssignment(staff, `${employee.name}'s resume was assigned to you by ${req.staff.name}.`)

  res.json(employee.resume)
})

export const bulkAssign = asyncHandler(async (req, res) => {
  const { employeeIds, staffId } = req.body ?? {}
  if (!Array.isArray(employeeIds) || !employeeIds.length) return res.status(400).json({ message: 'employeeIds must be a non-empty array' })
  if (!staffId) return res.status(400).json({ message: 'staffId is required' })

  const staff = await StaffUser.findById(staffId)
  if (!staff) return res.status(404).json({ message: 'Staff account not found' })

  const result = await Employee.updateMany(
    { _id: { $in: employeeIds } },
    { $set: { 'resume.assignedTo': staff._id, 'resume.assignedOn': new Date(), 'resume.assignedBy': req.staff._id } }
  )

  await logStaffActivity(`${req.staff.name} assigned ${result.modifiedCount} resume(s) to ${staff.name}`, 'navy')
  await notifyAssignment(staff, `${result.modifiedCount} resume(s) were assigned to you by ${req.staff.name}.`)

  res.json({ modifiedCount: result.modifiedCount })
})

export const reviewResume = asyncHandler(async (req, res) => {
  const { decision, score, note } = req.body ?? {}
  if (!['verified', 'changes', 'rejected'].includes(decision)) {
    return res.status(400).json({ message: 'decision must be verified, changes or rejected' })
  }

  const employee = await Employee.findById(req.params.employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })
  if (employee.resume.status === 'none') return res.status(400).json({ message: 'This employee has not uploaded a resume yet' })

  const isOwner = employee.resume.assignedTo && employee.resume.assignedTo.equals(req.staff._id)
  if (req.staff.accessLevel !== 'admin' && !isOwner) {
    return res.status(403).json({ message: 'This resume is not assigned to you' })
  }

  employee.resume.status = decision
  employee.resume.score = score ?? employee.resume.score
  employee.resume.note = note ?? ''
  employee.resume.reviewer = req.staff.name
  employee.resume.reviewerRole = req.staff.role
  employee.resume.verifiedOn = decision === 'verified' ? new Date() : employee.resume.verifiedOn

  await employee.save()
  await logStaffActivity(`${employee.name}'s resume marked "${decision}" by ${req.staff.name}`, decision === 'verified' ? 'green' : 'gold')
  await notifyEmployee(employee, { category: 'resume', title: 'Resume review update', body: RESUME_DECISION_MESSAGES[decision] })

  res.json(employee.resume)
})
