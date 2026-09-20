import { Router } from 'express'
import { listLatestJobs, getPublicJobSuggestions, getLatestJob, getPublicCategoryCounts, getPublicHotCities } from '../controllers/publicJobsController.js'
import { getJobFacets } from '../controllers/employeePublicJobsController.js'

const router = Router()

// '/suggestions', '/categories' and '/hot-cities' must come before '/:id' —
// otherwise Express would match them as an :id param and hand them to
// getLatestJob instead.
router.get('/suggestions', getPublicJobSuggestions)
router.get('/categories', getPublicCategoryCounts)
router.get('/hot-cities', getPublicHotCities)
// Same live filter counts the dashboard uses — safe to expose, it only ever counts
// candidate-visible jobs (see getJobFacets).
router.get('/facets', getJobFacets)
router.get('/:id', getLatestJob)
router.get('/', listLatestJobs)

export default router
