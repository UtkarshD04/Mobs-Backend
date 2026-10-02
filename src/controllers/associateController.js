import { asyncHandler } from '../utils/asyncHandler.js'
import PlacementAssociate from '../models/PlacementAssociate.js'
import { parseAssociateInput } from '../utils/associateInput.js'

// Public — the "Associate with Mzobs" form on the landing site, for placement
// companies in large and small cities.
export const submitAssociate = asyncHandler(async (req, res) => {
  const { data, error } = parseAssociateInput(req.body)
  if (error) return res.status(400).json({ message: error })

  const associate = await PlacementAssociate.create(data)
  res.status(201).json({ id: associate.id })
})
