import { Router } from 'express'
import { listLatestJobs, getPublicJobSuggestions, getLatestJob, getPublicCategoryCounts } from '../controllers/publicJobsController.js'

const router = Router()

// '/suggestions' and '/categories' must come before '/:id' — otherwise
// Express would match them as an :id param and hand them to getLatestJob
// instead.
router.get('/suggestions', getPublicJobSuggestions)
router.get('/categories', getPublicCategoryCounts)
router.get('/:id', getLatestJob)
router.get('/', listLatestJobs)

export default router
