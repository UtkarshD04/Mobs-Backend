import { Router } from 'express'
import { requireEmployeeAuth } from '../middleware/employeeAuth.js'
import { listPublicJobs, getPublicJob, getJobFacets, getJobSuggestions } from '../controllers/employeePublicJobsController.js'
import { getRecommendedJobs } from '../controllers/employeeRecommendationsController.js'

const router = Router()

// Genuinely public — browsing/searching/filtering openings needs no
// account. `publicJob()` already strips fee/invoice/sourcing data, and none
// of these handlers read `req.employee`. Only applying (employeeApplicationRoutes)
// and recommendations (below — needs a profile to match against) require auth.
router.get('/', listPublicJobs)
router.get('/facets', getJobFacets)
router.get('/suggestions', getJobSuggestions)
router.get('/recommended', requireEmployeeAuth, getRecommendedJobs)
router.get('/:id', getPublicJob)

export default router
