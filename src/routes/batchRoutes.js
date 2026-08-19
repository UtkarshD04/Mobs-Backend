import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { listBatches, getBatch } from '../controllers/batchController.js'

const router = Router()

router.use(requireAuth)

router.get('/', listBatches)
router.get('/:id', getBatch)

export default router
