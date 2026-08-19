import { asyncHandler } from '../utils/asyncHandler.js'
import { paginationParams, paginate, setPaginationHeaders } from '../utils/paginate.js'
import Batch from '../models/Batch.js'

export const listBatches = asyncHandler(async (req, res) => {
  const { data, page, limit, total } = await paginate(Batch, { company: req.company._id }, paginationParams(req), { sort: { createdAt: -1 } })
  setPaginationHeaders(res, { page, limit, total })
  res.json(data)
})

export const getBatch = asyncHandler(async (req, res) => {
  const batch = await Batch.findOne({ _id: req.params.id, company: req.company._id })
  if (!batch) return res.status(404).json({ message: 'Batch not found' })
  res.json(batch)
})
