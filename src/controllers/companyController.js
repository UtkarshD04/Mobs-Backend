import { asyncHandler } from '../utils/asyncHandler.js'
import Company from '../models/Company.js'

const EDITABLE_FIELDS = ['name', 'industry', 'size', 'founded', 'website', 'linkedin', 'hq', 'about']

export const getCompany = asyncHandler(async (req, res) => {
  res.json(req.company)
})

export const updateCompany = asyncHandler(async (req, res) => {
  const updates = {}
  for (const field of EDITABLE_FIELDS) {
    if (req.body[field] !== undefined) updates[field] = req.body[field]
  }

  const company = await Company.findByIdAndUpdate(req.company._id, updates, {
    new: true,
    runValidators: true,
  })

  res.json(company)
})
