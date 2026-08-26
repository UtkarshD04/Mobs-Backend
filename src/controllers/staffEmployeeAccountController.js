import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Employee from '../models/Employee.js'
import Application from '../models/Application.js'
import Conversation from '../models/Conversation.js'
import EmployeeNotification from '../models/EmployeeNotification.js'
import MockInterview from '../models/MockInterview.js'
import SupportTicket from '../models/SupportTicket.js'
import Candidate from '../models/Candidate.js'

export const listEmployees = asyncHandler(async (req, res) => {
  const { search, status } = req.query
  const query = {}

  if (status && status !== 'all') query.status = status
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ name: regex }, { email: regex }]
  }

  const { data, page, limit, total } = await paginate(Employee, query, paginationParams(req), {
    sort: { createdAt: -1 },
    select: '-passwordHash',
  })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

// Staff-provisioned account, same temp-password pattern as createTeammate —
// there's no invite-accept flow in this codebase, so the account needs
// credentials the staff member can hand to the candidate directly.
export const createEmployee = asyncHandler(async (req, res) => {
  const { name, email, phone, graduation, experience } = req.body ?? {}
  if (!name || !email || !graduation) {
    return res.status(400).json({ message: 'name, email and graduation are required' })
  }

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

// Hard delete cascades to records that exist solely to serve this employee's
// own account (applications, conversations, in-app notifications, mock
// interviews, their own support tickets). Financial records (Payment) and
// the employer-facing shared-profile snapshot (Candidate) are left as
// historical records — same convention deleteCompany already follows for
// its own non-User dependents — with Candidate.employee nulled so it
// doesn't keep a broken reference.
export const deleteEmployee = asyncHandler(async (req, res) => {
  const employee = await Employee.findById(req.params.employeeId)
  if (!employee) return res.status(404).json({ message: 'Employee not found' })

  await Promise.all([
    Application.deleteMany({ employee: employee._id }),
    Conversation.deleteMany({ employee: employee._id }),
    EmployeeNotification.deleteMany({ employee: employee._id }),
    MockInterview.deleteMany({ employee: employee._id }),
    SupportTicket.deleteMany({ employee: employee._id }),
    Candidate.updateMany({ employee: employee._id }, { employee: null }),
  ])
  await employee.deleteOne()

  await logStaffActivity(`${req.staff.name} deleted ${employee.name}'s employee account`, 'gold')

  res.json({ id: req.params.employeeId })
})
