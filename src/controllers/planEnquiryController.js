import { asyncHandler } from '../utils/asyncHandler.js'
import PlanEnquiry from '../models/PlanEnquiry.js'
import { parsePlanEnquiryInput } from '../utils/planEnquiryInput.js'
import { logStaffActivity } from '../utils/staffActivityLog.js'

// Public — the "Customize plan" form on the pricing page and in the employer app.
export const submitPlanEnquiry = asyncHandler(async (req, res) => {
  const { data, error } = parsePlanEnquiryInput(req.body)
  if (error) return res.status(400).json({ message: error })

  const enquiry = await PlanEnquiry.create(data)
  await logStaffActivity(`Custom plan enquiry from ${data.companyName} (${data.name})`, 'gold').catch(() => {})
  res.status(201).json({ id: enquiry.id })
})
