import { query } from '../db/pool.js'
import { stripeService } from './stripe.service.js'
import { emailService } from './email.service.js'
import { AppError } from '../utils/helpers.js'
import { env } from '../config/env.js'

export const subscriptionService = {
  async getByBusiness(businessId) {
    const result = await query('SELECT * FROM subscriptions WHERE business_id = $1', [businessId])
    return result.rows[0] || { plan: 'free', status: 'active' }
  },

  async createCheckout(businessId, userId, plan) {
    const business = await query(
      'SELECT b.*, u.email, u.name FROM businesses b JOIN users u ON u.id = b.user_id WHERE b.id = $1 AND b.user_id = $2',
      [businessId, userId],
    )
    if (business.rows.length === 0) throw new AppError('Business not found', 404)

    const sub = await this.getByBusiness(businessId)
    let customerId = sub.stripe_customer_id

    if (!customerId) {
      const customer = await stripeService.createCustomer(business.rows[0].email, business.rows[0].name)
      customerId = customer.id
      await query(
        'UPDATE subscriptions SET stripe_customer_id = $1, updated_at = NOW() WHERE business_id = $2',
        [customerId, businessId],
      )
    }

    const session = await stripeService.createCheckoutSession({
      customerId,
      plan,
      businessId,
      successUrl: `${env.BUSINESS_PORTAL_URL}/?checkout=success`,
      cancelUrl: `${env.BUSINESS_PORTAL_URL}/?checkout=cancelled`,
    })

    return { sessionId: session.id, url: session.url }
  },

  async createPortal(businessId, userId) {
    const business = await query('SELECT id FROM businesses WHERE id = $1 AND user_id = $2', [businessId, userId])
    if (business.rows.length === 0) throw new AppError('Access denied', 403)

    const sub = await this.getByBusiness(businessId)
    if (!sub.stripe_customer_id) throw new AppError('No active Stripe customer', 400)

    const session = await stripeService.createPortalSession(
      sub.stripe_customer_id,
      `${env.BUSINESS_PORTAL_URL}/`,
    )
    return { url: session.url }
  },

  async handleWebhook(event) {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const { businessId, plan } = session.metadata
        await query(
          `UPDATE subscriptions SET plan = $1, stripe_subscription_id = $2, status = 'active', updated_at = NOW()
           WHERE business_id = $3`,
          [plan, session.subscription, businessId],
        )
        const biz = await query(
          'SELECT u.email FROM businesses b JOIN users u ON u.id = b.user_id WHERE b.id = $1',
          [businessId],
        )
        if (biz.rows[0]) {
          await emailService.sendSubscriptionConfirmation(biz.rows[0].email, plan)
        }
        break
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object
        const customerId = invoice.customer
        const sub = await query('SELECT business_id FROM subscriptions WHERE stripe_customer_id = $1', [customerId])
        if (sub.rows[0]) {
          await query(
            `INSERT INTO payments (business_id, stripe_payment_intent_id, amount, plan, status)
             VALUES ($1, $2, $3, $4, 'succeeded')`,
            [sub.rows[0].business_id, invoice.payment_intent, invoice.amount_paid, 'subscription'],
          )
          const biz = await query(
            'SELECT u.email FROM businesses b JOIN users u ON u.id = b.user_id WHERE b.id = $1',
            [sub.rows[0].business_id],
          )
          if (biz.rows[0]) {
            await emailService.sendPaymentReceipt(biz.rows[0].email, invoice.amount_paid, 'subscription')
          }
        }
        break
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        await query(
          `UPDATE subscriptions SET plan = 'free', status = 'cancelled', stripe_subscription_id = NULL, updated_at = NOW()
           WHERE stripe_subscription_id = $1`,
          [subscription.id],
        )
        break
      }
    }
  },

  async getPaymentHistory(businessId) {
    const result = await query(
      'SELECT * FROM payments WHERE business_id = $1 ORDER BY created_at DESC',
      [businessId],
    )
    return result.rows
  },
}
