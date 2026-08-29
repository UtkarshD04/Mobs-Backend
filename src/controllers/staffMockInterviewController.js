import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import MockInterview from '../models/MockInterview.js'
import Employee from '../models/Employee.js'
import StaffUser from '../models/StaffUser.js'
import { notifyEmployee } from '../utils/notifyEmployee.js'

const MOCK_STATUSES = ['scheduled', 'completed', 'no_show']

// Per-HR breakdown of mock interviews they've scheduled/conducted — mirrors
// staffResumeController.stats' perStaff shape so the admin panel can render
// both with the same pattern.
export const mockInterviewStats = asyncHandler(async (req, res) => {
  const rows = await MockInterview.aggregate([
    { $match: { scheduledBy: { $ne: null } } },
    { $group: { _id: { staff: '$scheduledBy', status: '$status' }, count: { $sum: 1 } } },
  ])

  const byStaffMap = new Map()
  for (const row of rows) {
    const key = row._id.staff.toString()
    if (!byStaffMap.has(key)) byStaffMap.set(key, MOCK_STATUSES.reduce((acc, s) => ({ ...acc, [s]: 0 }), { staffId: key, total: 0 }))
    const entry = byStaffMap.get(key)
    if (MOCK_STATUSES.includes(row._id.status)) entry[row._id.status] = row.count
    entry.total += row.count
  }

  const staffDocs = await StaffUser.find({ _id: { $in: [...byStaffMap.keys()] } }).select('name email')
  const staffLookup = new Map(staffDocs.map((s) => [s._id.toString(), s]))
  const perStaff = [...byStaffMap.values()].map((entry) => ({
    ...entry,
    name: staffLookup.get(entry.staffId)?.name ?? 'Unknown',
    email: staffLookup.get(entry.staffId)?.email ?? '',
  }))

  res.json({ perStaff })
})

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
  if (employee.resume.status !== 'verified') {
    return res.status(400).json({ message: 'Resume must be verified before scheduling a mock interview' })
  }

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
  await notifyEmployee(employee, {
    category: 'training',
    title: 'Mock interview scheduled',
    body: `Your mock interview is scheduled for ${new Date(when).toLocaleString('en-IN')}.`,
  })

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

  const completedEmployee = await Employee.findById(interview.employee?._id ?? interview.employee)
  if (completedEmployee) {
    await notifyEmployee(completedEmployee, {
      category: 'training',
      title: 'Mock interview completed',
      body: 'Your mock interview has been completed — feedback will be shared soon.',
    })
  }

  res.json(interview)
})

export const markNoShow = asyncHandler(async (req, res) => {
  const interview = await MockInterview.findById(req.params.id)
  if (!interview) return res.status(404).json({ message: 'Mock interview not found' })

  interview.status = 'no_show'
  await interview.save()

  const employee = await Employee.findById(interview.employee)
  if (employee) {
    await notifyEmployee(employee, {
      category: 'training',
      title: 'Mock interview missed',
      body: 'You were marked as a no-show for your scheduled mock interview. Reach out to reschedule.',
    })
  }

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
  await notifyEmployee(employee, {
    category: 'track',
    title: 'Skill track assigned',
    body: `You've been assigned to the ${label ?? key} track${grade ? ` (Grade ${grade})` : ''}.`,
  })

  res.json(employee.skillTrack)
})

// Gives a candidate a trust score after their mock interview — this is what
// auto-shortlists them onto the Shortlisted page. Re-scoring preserves any
// existing sent_to_ops status/timestamps instead of resetting the hand-off.
export const setTrustScore = asyncHandler(async (req, res) => {
  const { score, note } = req.body ?? {}
  if (typeof score !== 'number' || score < 0 || score > 100) {
    return res.status(400).json({ message: 'score must be a number between 0 and 100' })
  }

  const employee = await Employee.findById(req.params.employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })

  const completedInterview = await MockInterview.findOne({ employee: employee._id, status: 'completed' })
  if (!completedInterview) {
    return res.status(400).json({ message: 'This candidate must complete a mock interview before a trust score can be given' })
  }

  employee.shortlist = {
    trustScore: score,
    scoredOn: new Date(),
    scoredBy: req.staff.name,
    note: note ?? '',
    status: employee.shortlist?.status === 'sent_to_ops' ? 'sent_to_ops' : 'shortlisted',
    sentToOpsOn: employee.shortlist?.sentToOpsOn ?? null,
    sentToOpsBy: employee.shortlist?.sentToOpsBy ?? null,
  }
  await employee.save()

  await logStaffActivity(`${employee.name} scored ${score}/100 and was shortlisted`, 'green')

  res.json(employee.shortlist)
})
