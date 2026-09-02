import { Router } from 'express'
import { authenticate, authorize } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { businessService } from '../services/business.service.js'
import { aiReviewSummaryService } from '../services/aiReviewSummary.service.js'
import { paginate, AppError } from '../utils/helpers.js'
import { logoUploadMemory } from '../middleware/upload.js'

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

router.get('/featured', async (_req, res, next) => {
  try {
    const result = await businessService.getFeatured()
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

router.get('/pricing', async (_req, res, next) => {
  try {
    const pricing = await businessService.getPricingContent()
    res.json({ success: true, data: pricing })
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

router.post(
  '/:id/logo',
  authenticate,
  authorize('business'),
  (req, res, next) => {
    logoUploadMemory.single('logo')(req, res, (err) => {
      if (!err) return next()
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('Logo file is too large. Maximum size is 2MB.', 400))
      }
      return next(err)
    })
  },
  async (req, res, next) => {
    try {
      if (!req.file?.buffer) {
        throw new AppError('Please upload a logo image (PNG, JPG, or WEBP).', 400)
      }
      const business = await businessService.updateLogo(req.params.id, req.user.id, {
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
      })
      res.json({ success: true, data: business })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/:id/review-summary', async (req, res, next) => {
  try {
    const force = String(req.query.force || '') === '1'
    const summary = await aiReviewSummaryService.getSummary(req.params.id, { force })
    res.json({ success: true, data: summary })
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

router.delete('/:id', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const result = await businessService.deleteOwnedBusiness(req.params.id, req.user.id)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.get('/:id/analytics', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const analytics = await businessService.getAnalytics(req.params.id, req.user.id)
    res.json({ success: true, data: analytics })
  } catch (err) {
    next(err)
  }
})

export default router
