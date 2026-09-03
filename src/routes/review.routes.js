import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { reviewService } from '../services/review.service.js'
import { query } from '../db/pool.js'
import { notificationService } from '../services/notification.service.js'

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

router.get('/invite/:token', async (req, res, next) => {
  try {
    const invitation = await reviewService.getInvitationByToken(req.params.token)
    res.json({ success: true, data: invitation })
  } catch (err) {
    next(err)
  }
})

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
        inviteToken: req.body.inviteToken || null,
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

// ── Review Reports ─────────────────────────────────────────────────────────
router.post(
  '/:id/report',
  [
    body('reason').trim().notEmpty().withMessage('Reason is required'),
    body('details').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      // Ensure table exists
      await query(`
        CREATE TABLE IF NOT EXISTS review_reports (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          review_id UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
          reporter_name TEXT,
          reporter_email TEXT,
          reason TEXT NOT NULL,
          details TEXT,
          status TEXT NOT NULL DEFAULT 'open',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)

      // Get review info for notification
      const reviewRow = await query(
        `SELECT r.id, r.title, b.name AS business_name
         FROM reviews r
         LEFT JOIN businesses b ON b.id = r.business_id
         WHERE r.id = $1`,
        [req.params.id],
      )
      if (reviewRow.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Review not found' })
      }
      const rev = reviewRow.rows[0]

      const result = await query(
        `INSERT INTO review_reports (review_id, reporter_name, reporter_email, reason, details)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          req.params.id,
          req.body.reporterName || null,
          req.body.reporterEmail || null,
          req.body.reason,
          req.body.details || null,
        ],
      )

      // Notify all CRM staff
      await notificationService.notifyCrmStaff(
        'Review reported',
        `A review "${rev.title || 'Untitled'}" for "${rev.business_name || 'a business'}" has been reported: ${req.body.reason}`,
        'review_report',
        `/reviews`,
      )

      res.status(201).json({ success: true, data: result.rows[0] })
    } catch (err) {
      next(err)
    }
  },
)

export default router
