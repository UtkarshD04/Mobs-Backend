import { Router } from 'express'
import { listPublicJobs, getPublicJob, getJobFacets, getJobSuggestions } from '../controllers/employeePublicJobsController.js'

const router = Router()

// Genuinely public — browsing/searching/filtering openings needs no
// account. `publicJob()` already strips fee/invoice/sourcing data, and none
// of these handlers read `req.employee`. Only applying (employeeApplicationRoutes)
// requires auth.
router.get('/', listPublicJobs)
router.get('/facets', getJobFacets)
router.get('/suggestions', getJobSuggestions)
router.get('/:id', getPublicJob)

export default router
