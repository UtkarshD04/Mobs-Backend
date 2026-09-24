import { Router } from 'express'
import {
  listLatestJobs,
  getPublicJobSuggestions,
  getLatestJob,
  getPublicCategoryCounts,
  getPublicHotCities,
  getPublicHiringCompanies,
} from '../controllers/publicJobsController.js'

const router = Router()

// '/suggestions', '/categories', '/hot-cities' and '/hiring-companies' must
// come before '/:id' — otherwise Express would match them as an :id param
// and hand them to getLatestJob instead.
router.get('/suggestions', getPublicJobSuggestions)
router.get('/categories', getPublicCategoryCounts)
router.get('/hot-cities', getPublicHotCities)
router.get('/hiring-companies', getPublicHiringCompanies)
router.get('/:id', getLatestJob)
router.get('/', listLatestJobs)

export default router
