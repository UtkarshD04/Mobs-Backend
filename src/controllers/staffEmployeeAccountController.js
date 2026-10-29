import { escapeRegex } from '../utils/jobQueryFilters.js'
import { isValidPhone, MOBILE_ERROR } from '../utils/indianMobile.js'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Employee from '../models/Employee.js'
import { deleteEmployeeAccount } from '../utils/accountDeletion.js'
import { serializeResumeSubdoc } from '../utils/resumeAccess.js'
import { sendCsv } from '../utils/csv.js'

export const listEmployees = asyncHandler(async (req, res) => {
  const { search, status } = req.query
  const query = {}

  if (status && status !== 'all') query.status = status
  if (search) {
    const regex = new RegExp(escapeRegex(String(search)), 'i')
    query.$or = [{ name: regex }, { email: regex }]
  }

  const { data, page, limit, total } = await paginate(Employee, query, paginationParams(req), {
    sort: { createdAt: -1 },
    select: '-passwordHash',
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

// GET /api/staff/employees/export — every candidate account as a CSV
// (not capped like the paginated list). Honors the same status/search filters,
// or exports only the candidates in `ids` (comma-separated) when given.
export const exportEmployees = asyncHandler(async (req, res) => {
  const { search, status, ids } = req.query
  const query = {}
  if (ids) {
    const list = String(ids).split(',').filter((id) => /^[a-f\d]{24}$/i.test(id))
    query._id = { $in: list }
  }
  if (status && status !== 'all') query.status = status
  if (search) {
    const escaped = String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(escaped, 'i')
    query.$or = [{ name: regex }, { email: regex }]
  }

  const employees = await Employee.find(query).select('-passwordHash').sort({ createdAt: -1 }).lean()
  const headers = [
    'Name', 'Email', 'Phone', 'Status', 'Gender', 'DOB', 'City', 'State', 'Pincode', 'College', 'Graduation',
    'Experience', 'Experience Years', 'Current Company', 'Designation', 'Current CTC', 'Notice Period',
    'Preferred Role', 'Skills', 'Preferred Locations', 'LinkedIn', 'GitHub', 'Portfolio',
    'Resume Status', 'Resume File', 'Resume Uploaded On', 'Skill Track', 'Trust Score',
    'Subscription', 'Subscription Amount', 'Paid On', 'Joined On', 'Last Active',
  ]
  const rows = employees.map((e) => [
    e.name, e.email, e.phone, e.status, e.gender, e.dob, e.currentCity, e.state, e.pincode, e.college, e.graduation,
    e.experience, e.experienceYears, e.currentCompany, e.designation, e.currentCtc, e.noticePeriod,
    e.preferredRole, (e.skills ?? []).join('; '), (e.preferredLocations ?? []).join('; '), e.linkedin, e.github, e.portfolioLink,
    e.resume?.status, e.resume?.file, e.resume?.uploadedOn, e.skillTrack?.label, e.shortlist?.trustScore,
    e.subscription?.status, e.subscription?.status === 'paid' ? e.subscription.amount : '', e.subscription?.paidOn, e.createdAt, e.lastActiveAt,
  ])
  sendCsv(res, `employees-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows)
})

// GET /api/staff/employees/:employeeId — one candidate's full profile for the
// admin's detail view, with a fresh short-lived link to their resume (the
// S3 key itself never leaves the server — see resumeAccess.js).
export const getEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.employeeId).select('-passwordHash -pushTokens -webPushSubscriptions +resume.s3Key')
  if (!employee) return res.status(404).json({ message: 'Employee not found' })

  const json = employee.toJSON()
  json.resume = serializeResumeSubdoc(employee.resume, 'staff-resume')
  res.json(json)
})

// Staff-provisioned account, same temp-password pattern as createTeammate —
// there's no invite-accept flow in this codebase, so the account needs
// credentials the staff member can hand to the candidate directly.
export const createEmployee = asyncHandler(async (req, res) => {
  const { name, email, phone, graduation, experience } = req.body ?? {}
  if (!name || !email || !graduation) {
    return res.status(400).json({ message: 'name, email and graduation are required' })
  }

  if (phone && !isValidPhone(phone)) return res.status(400).json({ message: MOBILE_ERROR })

  const normalizedEmail = email.toLowerCase().trim()
  const existing = await Employee.findOne({ email: normalizedEmail })
  if (existing) return res.status(409).json({ message: 'An employee account with this email already exists' })

  const tempPassword = crypto.randomBytes(9).toString('base64url')
  const passwordHash = await bcrypt.hash(tempPassword, 10)

  const employee = await Employee.create({
    name: name.trim(),
    email: normalizedEmail,
    phone: phone?.trim() ?? '',
    graduation,
    experience: experience === 'experienced' ? 'experienced' : 'fresher',
    passwordHash,
  })

  await logStaffActivity(`${req.staff.name} created an employee account for ${employee.name}`, 'navy')

  employee.passwordHash = undefined
  res.status(201).json({ employee, tempPassword })
})

export const setEmployeeStatus = asyncHandler(async (req, res) => {
  const { status } = req.body ?? {}
  if (!['active', 'suspended'].includes(status)) {
    return res.status(400).json({ message: 'status must be active or suspended' })
  }

  const employee = await Employee.findById(req.params.employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })

  employee.status = status
  await employee.save()

  await logStaffActivity(`${req.staff.name} ${status === 'suspended' ? 'suspended' : 'reactivated'} ${employee.name}'s account`, status === 'suspended' ? 'red' : 'green')

  res.json({ id: employee._id.toString(), status: employee.status })
})

// Same cascade as the employee's own self-service delete (deleteAccount in
// employeeProfileController.js) and the public deletion page
// (accountDeletionController.js) — utils/accountDeletion.js is the one
// place that cascade is defined, per Play Store's Account Deletion policy.
export const deleteEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })

  const name = employee.name
  await deleteEmployeeAccount(employee._id)

  await logStaffActivity(`${req.staff.name} deleted ${name}'s employee account`, 'gold')

  res.json({ id: req.params.employeeId })
})
