import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import User from '../models/User.js'

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Every employer-side login (User) across all companies, with its company
// joined in — the company list shows one row per company, this shows one
// row per person.
export const listEmployers = asyncHandler(async (req, res) => {
  const { status, role, company, search } = req.query
  const query = {}

  if (status && status !== 'all') query.status = status
  if (role && role !== 'all') query.role = role
  if (company) query.company = company
  if (search) {
    const regex = new RegExp(escapeRegex(String(search)), 'i')
    query.$or = [{ name: regex }, { email: regex }, { phone: regex }]
  }

  const { data, page, limit, total } = await paginate(User, query, paginationParams(req), {
    sort: { createdAt: -1 },
    populate: { path: 'company', select: 'name verificationStatus blocked' },
  })

  setPaginationHeaders(res, { page, limit, total })
  res.json(
    data.map((u) => {
      const json = u.toJSON()
      return { ...json, company: u.company ? { id: u.company._id.toString(), name: u.company.name, verificationStatus: u.company.verificationStatus, blocked: !!u.company.blocked } : null }
    })
  )
})
