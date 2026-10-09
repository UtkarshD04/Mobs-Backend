import { asyncHandler } from '../utils/asyncHandler.js'
import CampusRequest from '../models/CampusRequest.js'
import { parseCampusRequestInput } from '../utils/campusRequestInput.js'
import { alertNewCampusRequest } from '../utils/campusRequestAlert.js'

// Public — the "Add Your Campus" form on the landing site.
export const submitCampusRequest = asyncHandler(async (req, res) => {
  const { data, error } = parseCampusRequestInput(req.body)
  if (error) return res.status(400).json({ message: error })

  const request = await CampusRequest.create(data)
  res.status(201).json({ id: request.id })
  // After responding — emailing the ops team shouldn't slow down or fail the form.
  alertNewCampusRequest(request).catch(() => {})
})
