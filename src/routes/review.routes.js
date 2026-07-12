import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { reviewService } from '../services/review.service.js'

const router = Router()

router.get('/latest', async (req, res, next) => {
  try {
    const result = await reviewService.getLatest(req.query)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.get('/my', authenticate, authorize('customer'), async (req, res, next) => {
  try {
    const reviews = await reviewService.getByUser(req.user.id)
    res.json({ success: true, data: reviews })
  } catch (err) {
    next(err)
  }
})

router.get('/business/:businessId', async (req, res, next) => {
  try {
    const result = await reviewService.getByBusiness(req.params.businessId, req.query)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.post(
  '/invitations',
  authenticate,
  authorize('business'),
  [
    body('businessId').notEmpty().withMessage('Business ID is required'),
    body('email').isEmail().withMessage('Valid email required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const invitation = await reviewService.sendInvitation(
        req.body.businessId,
        req.user.id,
        req.body.email,
      )
      res.status(201).json({ success: true, data: invitation })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/invitations/:businessId', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const invitations = await reviewService.getInvitations(req.params.businessId, req.user.id)
    res.json({ success: true, data: invitations })
  } catch (err) {
    next(err)
  }
})

router.post(
  '/',
  authenticate,
  authorize('customer'),
  [
    body('businessId').notEmpty().withMessage('Business ID is required'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5'),
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('content').trim().isLength({ min: 10 }).withMessage('Review must be at least 10 characters'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await reviewService.create({
        businessId: req.body.businessId,
        userId: req.user.id,
        rating: req.body.rating,
        title: req.body.title,
        content: req.body.content,
      })
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.put(
  '/:id',
  authenticate,
  authorize('customer'),
  [
    body('rating').optional().isInt({ min: 1, max: 5 }),
    body('title').optional().trim().notEmpty(),
    body('content').optional().trim().isLength({ min: 10 }),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await reviewService.update(req.params.id, req.user.id, req.body)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/:id/reply',
  authenticate,
  authorize('business'),
  [body('reply').trim().notEmpty().withMessage('Reply is required')],
  validate,
  async (req, res, next) => {
    try {
      const review = await reviewService.reply(req.params.id, req.user.id, req.body.reply)
      res.json({ success: true, data: review })
    } catch (err) {
      next(err)
    }
  },
)

export default router
