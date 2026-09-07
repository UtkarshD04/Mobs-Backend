import { Router } from 'express'
import { listLatestJobs, getPublicJobSuggestions, getLatestJob } from '../controllers/publicJobsController.js'

const router = Router()

// '/suggestions' must come before '/:id' — otherwise Express would match
// "suggestions" as an :id param and hand it to getLatestJob instead.
router.get('/suggestions', getPublicJobSuggestions)
router.get('/:id', getLatestJob)
router.get('/', listLatestJobs)

export default router
