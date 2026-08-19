import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Employee from '../models/Employee.js'

export const listResumeQueue = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const query = {}

  if (status && status !== 'all') query['resume.status'] = status
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ name: regex }, { email: regex }, { skills: regex }]
  }

  const { data, page, limit, total } = await paginate(Employee, query, paginationParams(req), {
    sort: { 'resume.uploadedOn': -1 },
    select: '-passwordHash',
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const reviewResume = asyncHandler(async (req, res) => {
  const { decision, score, note } = req.body ?? {}
  if (!['verified', 'changes', 'rejected'].includes(decision)) {
    return res.status(400).json({ message: 'decision must be verified, changes or rejected' })
  }

  const employee = await Employee.findById(req.params.employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })
  if (employee.resume.status === 'none') return res.status(400).json({ message: 'This employee has not uploaded a resume yet' })

  employee.resume.status = decision
  employee.resume.score = score ?? employee.resume.score
  employee.resume.note = note ?? ''
  employee.resume.reviewer = req.staff.name
  employee.resume.reviewerRole = req.staff.role
  employee.resume.verifiedOn = decision === 'verified' ? new Date() : employee.resume.verifiedOn

  await employee.save()
  await logStaffActivity(`${employee.name}'s resume marked "${decision}" by ${req.staff.name}`, decision === 'verified' ? 'green' : 'gold')

  res.json(employee.resume)
})
