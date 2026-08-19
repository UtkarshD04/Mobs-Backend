import { asyncHandler } from '../utils/asyncHandler.js'
import MockInterview from '../models/MockInterview.js'

export const getMockInterview = asyncHandler(async (req, res) => {
  const mockInterview = await MockInterview.findOne({ employee: req.employee._id }).sort({ createdAt: -1 })
  res.json(mockInterview ?? { status: 'not_scheduled' })
})
