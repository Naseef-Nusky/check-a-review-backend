import { Router } from 'express'
import { businessService } from '../services/business.service.js'
import { reviewService } from '../services/review.service.js'

const router = Router()

router.get('/:businessId', async (req, res, next) => {
  try {
    const business = await businessService.getBySlugOrId(req.params.businessId)
    const { reviews } = await reviewService.getByBusiness(business.id, { limit: 5 })

    const widgetData = {
      businessName: business.name,
      averageRating: parseFloat(business.average_rating) || 0,
      reviewCount: business.review_count || 0,
      trustScore: parseFloat(business.trust_score) || 0,
      recentReviews: reviews.map((r) => ({
        rating: r.rating,
        title: r.title,
        author: r.author_name,
        date: r.created_at,
      })),
    }

    res.json({ success: true, data: widgetData })
  } catch (err) {
    next(err)
  }
})

export default router
