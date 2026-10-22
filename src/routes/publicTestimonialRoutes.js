import { Router } from 'express'
import { listPublicTestimonials } from '../controllers/publicTestimonialsController.js'

const router = Router()
router.get('/', listPublicTestimonials)

export default router
