import { asyncHandler } from '../utils/asyncHandler.js'
import { hasActiveEmployerSubscription } from '../utils/employerSubscriptionAccess.js'

// Sits after requireAuth (needs req.company). Blocks job creation/publishing
// and applicant resume/contact access when the employer has no active plan —
// enforced here in the backend, not just by disabling buttons on the frontend.
export const requireActiveSubscription = asyncHandler(async (req, res, next) => {
  const active = await hasActiveEmployerSubscription(req.company._id)
  if (!active) {
    return res.status(403).json({
      code: 'EMPLOYER_SUBSCRIPTION_REQUIRED',
      message: 'Your employer plan is inactive. Subscribe to post jobs and view applicant resumes.',
    })
  }
  next()
})
