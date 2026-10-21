import { Router } from 'express'
import {
  listLatestJobs,
  getPublicJobSuggestions,
  getLatestJob,
  getPublicCategoryCounts,
  getPublicHotCities,
  getPublicHiringCompanies,
  getPublicPlatformStats,
} from '../controllers/publicJobsController.js'
import { responseCache } from '../middleware/responseCache.js'
import { getJobFacets } from '../controllers/employeePublicJobsController.js'

const router = Router()

// Landing-page aggregates: identical for every visitor, so a minute of caching cuts DB load a lot.
const cached = responseCache(60)

// '/suggestions', '/categories', '/hot-cities' and '/hiring-companies' must
// come before '/:id' — otherwise Express would match them as an :id param
// and hand them to getLatestJob instead.
router.get('/suggestions', getPublicJobSuggestions)
router.get('/categories', cached, getPublicCategoryCounts)
router.get('/hot-cities', cached, getPublicHotCities)
router.get('/hiring-companies', cached, getPublicHiringCompanies)
router.get('/platform-stats', cached, getPublicPlatformStats)
// Same live filter counts the dashboard uses — safe to expose, it only ever counts
// candidate-visible jobs (see getJobFacets).
router.get('/facets', cached, getJobFacets)
router.get('/:id', getLatestJob)
router.get('/', listLatestJobs)

export default router
