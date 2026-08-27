import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { subscriptionService } from '../services/subscription.service.js'
import { squareService } from '../services/square.service.js'

const router = Router()

router.get('/square-config', authenticate, authorize('business'), async (_req, res, next) => {
  try {
    res.json({ success: true, data: squareService.getClientConfig() })
  } catch (err) {
    next(err)
  }
})

router.post(
  '/register-apple-pay-domain',
  authenticate,
  authorize('business'),
  [body('domain').optional().isString()],
  validate,
  async (req, res, next) => {
    try {
      const fallback = (() => {
        try {
          return new URL(process.env.BUSINESS_PORTAL_URL || 'http://localhost:5175').hostname
        } catch {
          return ''
        }
      })()
      const domain = String(req.body.domain || fallback || '')
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        .trim()
      if (!domain || domain === 'localhost' || domain === '127.0.0.1') {
        return res.status(400).json({
          success: false,
          message:
            'Apple Pay requires a public HTTPS domain (not localhost). Set BUSINESS_PORTAL_URL to your live domain, then register it.',
        })
      }
      const result = await squareService.registerApplePayDomain(domain)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/:businessId', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const { assertBusinessAccess } = await import('../services/businessAccess.service.js')
    await assertBusinessAccess(req.params.businessId, req.user.id)
    const subscription = await subscriptionService.getByBusiness(req.params.businessId)
    const squareConfig = squareService.getClientConfig()
    res.json({
      success: true,
      data: {
        ...subscription,
        provider: 'square',
        squareConfigured: squareService.hasCredentials(),
        cardPaymentsEnabled: squareConfig.cardPaymentsEnabled,
      },
    })
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
    body('plan').isIn(['starter', 'plus', 'premium']).withMessage('Plan must be starter, plus, or premium'),
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
  '/pay-with-card',
  authenticate,
  authorize('business'),
  [
    body('businessId').notEmpty(),
    body('plan').isIn(['starter', 'plus', 'premium']).withMessage('Plan must be starter, plus, or premium'),
    body('sourceId').notEmpty().withMessage('Card token is required'),
    body('verificationToken').optional({ values: 'falsy' }).isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const subscription = await subscriptionService.payWithCard(
        req.body.businessId,
        req.user.id,
        req.body.plan,
        req.body.sourceId,
        req.body.verificationToken,
      )
      const squareConfig = squareService.getClientConfig()
      res.json({
        success: true,
        data: {
          ...subscription,
          provider: 'square',
          squareConfigured: squareService.hasCredentials(),
          cardPaymentsEnabled: squareConfig.cardPaymentsEnabled,
        },
      })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/confirm-checkout',
  authenticate,
  authorize('business'),
  [body('businessId').notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const subscription = await subscriptionService.confirmCheckout(
        req.body.businessId,
        req.user.id,
      )
      res.json({
        success: true,
        data: {
          ...subscription,
          provider: 'square',
          squareConfigured: squareService.hasCredentials(),
        },
      })
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

router.post(
  '/update-payment-method',
  authenticate,
  authorize('business'),
  [
    body('businessId').notEmpty(),
    body('sourceId').notEmpty().withMessage('Card token is required'),
    body('verificationToken').optional({ values: 'falsy' }).isString(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const subscription = await subscriptionService.updatePaymentMethod(
        req.body.businessId,
        req.user.id,
        req.body.sourceId,
        req.body.verificationToken,
      )
      const squareConfig = squareService.getClientConfig()
      res.json({
        success: true,
        data: {
          ...subscription,
          provider: 'square',
          squareConfigured: squareService.hasCredentials(),
          cardPaymentsEnabled: squareConfig.cardPaymentsEnabled,
        },
      })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/cancel',
  authenticate,
  authorize('business'),
  [body('businessId').notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const subscription = await subscriptionService.cancelSubscription(req.body.businessId, req.user.id)
      res.json({ success: true, data: subscription })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/:businessId/payments', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const { assertBusinessAccess } = await import('../services/businessAccess.service.js')
    await assertBusinessAccess(req.params.businessId, req.user.id)
    const payments = await subscriptionService.getPaymentHistory(req.params.businessId)
    res.json({ success: true, data: payments })
  } catch (err) {
    next(err)
  }
})

router.post('/webhook', async (req, res, next) => {
  try {
    const signature = req.headers['x-square-hmacsha256-signature']
    const event = await squareService.verifyWebhook(req.body, signature)
    await subscriptionService.handleWebhook(event)
    res.json({ received: true })
  } catch (err) {
    next(err)
  }
})

export default router
