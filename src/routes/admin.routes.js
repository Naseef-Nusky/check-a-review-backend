import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { adminService } from '../services/admin.service.js'
import { reviewService } from '../services/review.service.js'

const router = Router()

router.use(authenticate, authorize('admin'))

router.get('/dashboard', async (_req, res, next) => {
  try {
    const stats = await adminService.getDashboardStats()
    res.json({ success: true, data: stats })
  } catch (err) {
    next(err)
  }
})

router.get('/users', async (_req, res, next) => {
  try {
    const users = await adminService.getUsers()
    res.json({ success: true, data: users })
  } catch (err) {
    next(err)
  }
})

router.get('/businesses', async (_req, res, next) => {
  try {
    const businesses = await adminService.getBusinesses()
    res.json({ success: true, data: businesses })
  } catch (err) {
    next(err)
  }
})

router.get('/reviews', async (_req, res, next) => {
  try {
    const reviews = await adminService.getAllReviews()
    res.json({ success: true, data: reviews })
  } catch (err) {
    next(err)
  }
})

router.get('/reviews/flagged', async (_req, res, next) => {
  try {
    const reviews = await reviewService.getFlagged()
    res.json({ success: true, data: reviews })
  } catch (err) {
    next(err)
  }
})

router.patch(
  '/reviews/:id/moderate',
  [body('status').isIn(['published', 'rejected', 'reported']).withMessage('Invalid status')],
  validate,
  async (req, res, next) => {
    try {
      const review = await reviewService.moderate(req.params.id, req.body.status)
      res.json({ success: true, data: review })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/subscriptions', async (_req, res, next) => {
  try {
    const subscriptions = await adminService.getSubscriptions()
    res.json({ success: true, data: subscriptions })
  } catch (err) {
    next(err)
  }
})

router.get('/payments', async (_req, res, next) => {
  try {
    const payments = await adminService.getPayments()
    res.json({ success: true, data: payments })
  } catch (err) {
    next(err)
  }
})

router.get('/settings', async (_req, res, next) => {
  try {
    const settings = await adminService.getSettings()
    res.json({ success: true, data: settings })
  } catch (err) {
    next(err)
  }
})

router.put('/settings', async (req, res, next) => {
  try {
    const settings = await adminService.updateSettings(req.body)
    res.json({ success: true, data: settings })
  } catch (err) {
    next(err)
  }
})

export default router
