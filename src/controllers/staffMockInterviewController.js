import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import MockInterview from '../models/MockInterview.js'
import Employee from '../models/Employee.js'

export const listMockInterviews = asyncHandler(async (req, res) => {
  const { status } = req.query
  const query = {}
  if (status && status !== 'all') query.status = status

  const { data, page, limit, total } = await paginate(MockInterview, query, paginationParams(req), {
    sort: { when: 1 },
    populate: { path: 'employee', select: 'name email skills' },
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const scheduleMockInterview = asyncHandler(async (req, res) => {
  const { employeeId, when, panel, panelRole, mode, link, duration } = req.body ?? {}
  if (!employeeId || !when) return res.status(400).json({ message: 'employeeId and when are required' })

  const employee = await Employee.findById(employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })

  const interview = await MockInterview.create({
    employee: employeeId,
    status: 'scheduled',
    when,
    panel,
    panelRole,
    mode,
    link,
    duration,
    scheduledBy: req.staff._id,
  })

  await logStaffActivity(`Mock interview scheduled for ${employee.name}`, 'navy')

  res.status(201).json(interview)
})

export const completeMockInterview = asyncHandler(async (req, res) => {
  const { scores, feedback } = req.body ?? {}
  const interview = await MockInterview.findById(req.params.id).populate('employee', 'name')
  if (!interview) return res.status(404).json({ message: 'Mock interview not found' })

  interview.status = 'completed'
  interview.scores = scores ?? interview.scores
  interview.feedback = feedback ?? interview.feedback
  interview.completedOn = new Date()

  await interview.save()
  await logStaffActivity(`Mock interview completed for ${interview.employee?.name ?? 'candidate'}`, 'green')

  res.json(interview)
})

export const markNoShow = asyncHandler(async (req, res) => {
  const interview = await MockInterview.findById(req.params.id)
  if (!interview) return res.status(404).json({ message: 'Mock interview not found' })

  interview.status = 'no_show'
  await interview.save()

  res.json(interview)
})

export const assignSkillTrack = asyncHandler(async (req, res) => {
  const { key, label, grade, note } = req.body ?? {}
  if (!key) return res.status(400).json({ message: 'key is required' })

  const employee = await Employee.findById(req.params.employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })

  employee.skillTrack = { key, label: label ?? key, grade: grade ?? '', assignedOn: new Date(), assignedBy: req.staff.name, note: note ?? '' }
  await employee.save()

  await logStaffActivity(`${employee.name} assigned to the ${label ?? key} track (${grade ?? 'ungraded'})`, 'gold')

  res.json(employee.skillTrack)
})
