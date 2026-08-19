import { asyncHandler } from '../utils/asyncHandler.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Company from '../models/Company.js'
import User from '../models/User.js'

export const listCompanies = asyncHandler(async (req, res) => {
  const { status, search } = req.query
  const query = {}

  if (status && status !== 'all') query.verificationStatus = status
  if (search) {
    const regex = new RegExp(search, 'i')
    query.$or = [{ name: regex }, { hq: regex }, { industry: regex }]
  }

  const { data, page, limit, total } = await paginate(Company, query, paginationParams(req), { sort: { createdAt: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const getCompany = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id)
  if (!company) return res.status(404).json({ message: 'Company not found' })
  res.json(company)
})

export const verifyCompany = asyncHandler(async (req, res) => {
  const { method, note } = req.body ?? {}
  const company = await Company.findById(req.params.id)
  if (!company) return res.status(404).json({ message: 'Company not found' })

  company.verificationStatus = 'verified'
  company.verificationMethod = method ?? null
  company.verificationNote = note ?? ''
  company.verifiedOn = new Date()
  company.verifiedBy = req.staff.name

  await company.save()
  await logStaffActivity(`${company.name} verified via ${method ?? 'manual review'}`, 'green')

  res.json(company)
})

export const rejectCompany = asyncHandler(async (req, res) => {
  const { note } = req.body ?? {}
  const company = await Company.findById(req.params.id)
  if (!company) return res.status(404).json({ message: 'Company not found' })

  company.verificationStatus = 'rejected'
  company.verificationNote = note ?? ''
  company.verifiedOn = new Date()
  company.verifiedBy = req.staff.name

  await company.save()
  await logStaffActivity(`${company.name} verification rejected`, 'gold')

  res.json(company)
})

export const blockCompany = asyncHandler(async (req, res) => {
  const { reason } = req.body ?? {}
  const company = await Company.findById(req.params.id)
  if (!company) return res.status(404).json({ message: 'Company not found' })

  company.blocked = true
  company.blockReason = reason ?? ''
  company.blockedOn = new Date()
  company.blockedBy = req.staff.name

  await company.save()
  await logStaffActivity(`${company.name} blocked`, 'gold')

  res.json(company)
})

export const unblockCompany = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id)
  if (!company) return res.status(404).json({ message: 'Company not found' })

  company.blocked = false
  company.blockReason = ''
  company.blockedOn = null
  company.blockedBy = null

  await company.save()
  await logStaffActivity(`${company.name} unblocked`, 'green')

  res.json(company)
})

export const deleteCompany = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id)
  if (!company) return res.status(404).json({ message: 'Company not found' })

  // Removes the employer's login accounts along with the company record.
  // Jobs/applications/invoices already sourced under this company are left
  // as historical records rather than cascading further — same convention
  // deleteJob already follows for its own dependents.
  await User.deleteMany({ company: company._id })
  await company.deleteOne()

  await logStaffActivity(`${company.name} deleted`, 'gold')

  res.json({ id: req.params.id })
})
