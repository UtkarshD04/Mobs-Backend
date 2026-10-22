import { asyncHandler } from '../utils/asyncHandler.js'
import Testimonial from '../models/Testimonial.js'

// Public, unauthenticated. Only testimonials the candidate consented to AND
// staff approved are ever returned, and the response is an explicit allow-list
// — no employee id, email, phone, company or role can leak through it.
export const listPublicTestimonials = asyncHandler(async (_req, res) => {
  const rows = await Testimonial.find({ status: 'approved', publicConsent: true })
    .sort({ featured: -1, approvedAt: -1 })
    .limit(30)
    .select('displayName photoUrl feedback placementVerified featured')
    .lean()

  res.set('Cache-Control', 'public, max-age=300')
  res.json({
    testimonials: rows.map((t) => ({
      id: t._id.toString(),
      name: t.displayName,
      photo: t.photoUrl || '',
      feedback: t.feedback,
      placementVerified: !!t.placementVerified,
      featured: !!t.featured,
    })),
  })
})
