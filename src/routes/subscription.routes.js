import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { subscriptionService } from '../services/subscription.service.js'
import { stripeService } from '../services/stripe.service.js'
import { businessService } from '../services/business.service.js'

const router = Router()

router.get('/:businessId', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const subscription = await subscriptionService.getByBusiness(req.params.businessId)
    res.json({ success: true, data: subscription })
  } catch (err) {
    next(err)
  }
})

router.post(
  '/checkout',
  authenticate,
  authorize('business'),
  [
    body('businessId').notEmpty(),
    body('plan').isIn(['starter', 'premium']).withMessage('Plan must be starter or premium'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await subscriptionService.createCheckout(
        req.body.businessId,
        req.user.id,
        req.body.plan,
      )
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/portal',
  authenticate,
  authorize('business'),
  [body('businessId').notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const result = await subscriptionService.createPortal(req.body.businessId, req.user.id)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/:businessId/payments', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const business = await businessService.getByUserId(req.user.id)
    if (business.id !== req.params.businessId) {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }
    const payments = await subscriptionService.getPaymentHistory(req.params.businessId)
    res.json({ success: true, data: payments })
  } catch (err) {
    next(err)
  }
})

router.post('/webhook', async (req, res, next) => {
  try {
    const signature = req.headers['stripe-signature']
    const event = stripeService.constructWebhookEvent(req.body, signature)
    await subscriptionService.handleWebhook(event)
    res.json({ received: true })
  } catch (err) {
    next(err)
  }
})

export default router
