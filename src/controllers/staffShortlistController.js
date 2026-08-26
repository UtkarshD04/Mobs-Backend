import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Employee from '../models/Employee.js'

export const listShortlist = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const query = { 'shortlist.trustScore': { $ne: null } }

  if (req.staff.accessLevel !== 'admin') query['resume.assignedTo'] = req.staff._id
  if (status && status !== 'all') query['shortlist.status'] = status
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ name: regex }, { email: regex }, { skills: regex }]
  }

  const { data, page, limit, total } = await paginate(Employee, query, paginationParams(req), {
    sort: { 'shortlist.scoredOn': -1 },
    select: '-passwordHash',
    populate: ['resume.assignedTo', 'shortlist.sentToOpsBy'],
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const transferToOperations = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })
  if (employee.shortlist?.trustScore == null) {
    return res.status(400).json({ message: 'This candidate has not been given a trust score yet' })
  }

  employee.shortlist.status = 'sent_to_ops'
  employee.shortlist.sentToOpsOn = new Date()
  employee.shortlist.sentToOpsBy = req.staff._id
  await employee.save()

  await logStaffActivity(`${req.staff.name} sent ${employee.name} back to Operations`, 'navy')

  res.json(employee.shortlist)
})

export const bulkTransferToOperations = asyncHandler(async (req, res) => {
  const { employeeIds } = req.body ?? {}
  if (!Array.isArray(employeeIds) || !employeeIds.length) {
    return res.status(400).json({ message: 'employeeIds must be a non-empty array' })
  }

  const result = await Employee.updateMany(
    { _id: { $in: employeeIds }, 'shortlist.trustScore': { $ne: null } },
    { $set: { 'shortlist.status': 'sent_to_ops', 'shortlist.sentToOpsOn': new Date(), 'shortlist.sentToOpsBy': req.staff._id } }
  )

  await logStaffActivity(`${req.staff.name} sent ${result.modifiedCount} candidate(s) back to Operations`, 'navy')

  res.json({ modifiedCount: result.modifiedCount })
})
