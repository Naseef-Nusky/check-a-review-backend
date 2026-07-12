import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { businessService } from '../services/business.service.js'
import { paginate } from '../utils/helpers.js'

const router = Router()

router.get('/search', async (req, res, next) => {
  try {
    const { page, limit, offset } = paginate(req.query)
    const result = await businessService.search({
      q: req.query.q,
      category: req.query.category,
      page,
      limit,
      offset,
    })
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.get('/categories', async (_req, res, next) => {
  try {
    const categories = await businessService.getCategories()
    res.json({ success: true, data: categories })
  } catch (err) {
    next(err)
  }
})

router.get('/my/profile', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const business = await businessService.getByUserId(req.user.id)
    res.json({ success: true, data: business })
  } catch (err) {
    next(err)
  }
})

router.get('/:identifier', async (req, res, next) => {
  try {
    const business = await businessService.getBySlugOrId(req.params.identifier)
    res.json({ success: true, data: business })
  } catch (err) {
    next(err)
  }
})

router.put(
  '/:id',
  authenticate,
  authorize('business'),
  validate,
  async (req, res, next) => {
    try {
      const business = await businessService.update(req.params.id, req.user.id, req.body)
      res.json({ success: true, data: business })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/:id/analytics', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const analytics = await businessService.getAnalytics(req.params.id, req.user.id)
    res.json({ success: true, data: analytics })
  } catch (err) {
    next(err)
  }
})

export default router
