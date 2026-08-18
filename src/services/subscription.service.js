import { query } from '../db/pool.js'
import { squareService } from './square.service.js'
import { billingPlansService } from './billingPlans.service.js'
import { emailService } from './email.service.js'
import { AppError } from '../utils/helpers.js'
import { env } from '../config/env.js'
import { assertBusinessOwner } from './businessAccess.service.js'
import { PAID_SQUARE_PLANS } from '../config/planCatalog.js'
import { ensureAssignablePlans, getEntitlements } from './planEntitlements.service.js'

let squareColumnsReady = false

async function ensureSquareColumns() {
  if (squareColumnsReady) return
  await query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS square_customer_id VARCHAR(255)`)
  await query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS square_subscription_id VARCHAR(255)`)
  await query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pending_plan VARCHAR(20)`)
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS square_payment_id VARCHAR(255)`)
  await query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS stripe_customer_id`)
  await query(`ALTER TABLE subscriptions DROP COLUMN IF EXISTS stripe_subscription_id`)
  await query(`ALTER TABLE payments DROP COLUMN IF EXISTS stripe_payment_intent_id`)
  await ensureAssignablePlans()
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'payments_square_payment_id_key'
      ) THEN
        ALTER TABLE payments ADD CONSTRAINT payments_square_payment_id_key UNIQUE (square_payment_id);
      END IF;
    END $$;
  `)
  squareColumnsReady = true
}

function eventObject(event) {
  const data = event?.data?.object || {}
  return data.subscription || data.payment || data.invoice || data || {}
}

export const subscriptionService = {
  async getByBusiness(businessId) {
    await ensureSquareColumns()
    const result = await query('SELECT * FROM subscriptions WHERE business_id = $1', [businessId])
    const row = result.rows[0] || { plan: 'free', status: 'active' }
    const entitlements = await getEntitlements(businessId)
    const billingPlans = await billingPlansService.list().catch(() => [])
    return {
      ...row,
      entitlements,
      catalog: billingPlans,
      salesEmail: env.SALES_EMAIL,
    }
  },

  async createCheckout(businessId, userId, plan) {
    await ensureSquareColumns()
    if (!PAID_SQUARE_PLANS.includes(plan)) {
      throw new AppError('This plan is quoted by sales. Use Book demo instead of checkout.', 400)
    }
    if (!squareService.hasCredentials()) {
      throw new AppError('Square billing is not configured yet. Add Square sandbox keys to .env.', 503)
    }

    const planRow = await billingPlansService.getByKey(plan)
    if (!planRow.active) throw new AppError(`Plan "${plan}" is inactive`, 400)
    if (!planRow.squarePlanId) {
      throw new AppError(
        `Plan "${plan}" is not synced to Square yet. Open CRM → Billing plans and click Sync.`,
        400,
      )
    }

    await assertBusinessOwner(businessId, userId)
    const business = await query(
      'SELECT b.*, u.email, u.name FROM businesses b JOIN users u ON u.id = b.user_id WHERE b.id = $1',
      [businessId],
    )
    if (business.rows.length === 0) throw new AppError('Business not found', 404)

    const sub = await query('SELECT * FROM subscriptions WHERE business_id = $1', [businessId])
    let customerId = sub.rows[0]?.square_customer_id || null

    if (!customerId) {
      const customer = await squareService.createCustomer(business.rows[0].email, business.rows[0].name)
      customerId = customer.id
      await query(
        'UPDATE subscriptions SET square_customer_id = $1, updated_at = NOW() WHERE business_id = $2',
        [customerId, businessId],
      )
    }

    let amountCents = planRow.amountCents
    if (planRow.perDomain) {
      const domains = await query(
        `SELECT COUNT(*)::int AS count FROM business_domains WHERE business_id = $1 AND status = 'active'`,
        [businessId],
      )
      const domainCount = Math.max(1, domains.rows[0]?.count || 1)
      const maxDomains = Number.isFinite(planRow.domains) ? planRow.domains : domainCount
      amountCents = planRow.amountCents * Math.min(domainCount, maxDomains)
    }

    const link = await squareService.createCheckoutLink({
      customerId,
      plan,
      planConfig: {
        planId: planRow.squarePlanId,
        variationId: planRow.squareVariationId,
        amountCents,
        currency: planRow.currency,
        name: planRow.name,
      },
      businessId,
      email: business.rows[0].email,
      successUrl: `${env.BUSINESS_PORTAL_URL}/subscription?checkout=success`,
    })

    await query(
      `UPDATE subscriptions SET pending_plan = $1, updated_at = NOW() WHERE business_id = $2`,
      [plan, businessId],
    )

    return { sessionId: link.id, url: link.url, plan }
  },

  async createPortal(businessId, userId) {
    await ensureSquareColumns()
    await assertBusinessOwner(businessId, userId)
    return { url: `${env.BUSINESS_PORTAL_URL}/subscription` }
  },

  async cancelSubscription(businessId, userId) {
    await ensureSquareColumns()
    await assertBusinessOwner(businessId, userId)

    const sub = await this.getByBusiness(businessId)
    if (!sub.square_subscription_id) throw new AppError('No active Square subscription to cancel', 400)

    await squareService.cancelSubscription(sub.square_subscription_id)
    const result = await query(
      `UPDATE subscriptions
       SET plan = 'free',
           status = 'cancelled',
           square_subscription_id = NULL,
           updated_at = NOW()
       WHERE business_id = $1
       RETURNING *`,
      [businessId],
    )
    return result.rows[0]
  },

  async handleWebhook(event) {
    await ensureSquareColumns()
    const type = event?.type
    const obj = eventObject(event)

    if (type === 'subscription.created' || type === 'subscription.updated') {
      const subscriptionId = obj.id
      const customerId = obj.customer_id || obj.customerId
      const status = String(obj.status || '').toUpperCase()
      const note = safeJsonParse(obj.note) || safeJsonParse(obj.source?.name)
      const plan = note?.plan && PAID_SQUARE_PLANS.includes(note.plan) ? note.plan : null

      if (!customerId) return

      if (status === 'CANCELED' || status === 'DEACTIVATED') {
        await query(
          `UPDATE subscriptions
           SET plan = 'free', status = 'cancelled', square_subscription_id = NULL, updated_at = NOW()
           WHERE square_customer_id = $1 OR square_subscription_id = $2`,
          [customerId, subscriptionId],
        )
        return
      }

      const nextPlan = plan || (await inferPendingPlan(customerId))
      await query(
        `UPDATE subscriptions
         SET plan = COALESCE($1, plan),
             pending_plan = NULL,
             square_subscription_id = $2,
             square_customer_id = COALESCE(square_customer_id, $3),
             status = 'active',
             updated_at = NOW()
         WHERE square_customer_id = $3`,
        [nextPlan, subscriptionId, customerId],
      )

      if (nextPlan && type === 'subscription.created') {
        const biz = await query(
          `SELECT u.email
           FROM subscriptions s
           JOIN businesses b ON b.id = s.business_id
           JOIN users u ON u.id = b.user_id
           WHERE s.square_customer_id = $1
           LIMIT 1`,
          [customerId],
        )
        if (biz.rows[0]) {
          await emailService.sendSubscriptionConfirmation(biz.rows[0].email, nextPlan)
        }
      }
      return
    }

    if (type === 'payment.updated' || type === 'payment.created') {
      const payment = obj
      const paymentStatus = String(payment.status || '').toUpperCase()
      if (paymentStatus !== 'COMPLETED') return

      const note = safeJsonParse(payment.note)
      const customerId = payment.customer_id || payment.customerId || note?.customerId
      const amount = Number(payment.amount_money?.amount || payment.amountMoney?.amount || 0)
      const paymentId = payment.id
      if (!customerId || !paymentId) return

      const sub = await query(
        'SELECT business_id, plan FROM subscriptions WHERE square_customer_id = $1 LIMIT 1',
        [customerId],
      )
      if (!sub.rows[0]) return

      const plan = note?.plan || sub.rows[0].plan || 'subscription'
      if (note?.plan && PAID_SQUARE_PLANS.includes(note.plan)) {
        await query(
          `UPDATE subscriptions
           SET plan = $1, status = 'active', updated_at = NOW()
           WHERE business_id = $2`,
          [note.plan, sub.rows[0].business_id],
        )
      }

      await query(
        `INSERT INTO payments (business_id, square_payment_id, amount, plan, status)
         VALUES ($1, $2, $3, $4, 'succeeded')
         ON CONFLICT (square_payment_id) DO NOTHING`,
        [sub.rows[0].business_id, paymentId, amount, plan],
      )

      const biz = await query(
        'SELECT u.email FROM businesses b JOIN users u ON u.id = b.user_id WHERE b.id = $1',
        [sub.rows[0].business_id],
      )
      if (biz.rows[0] && amount > 0) {
        await emailService.sendPaymentReceipt(biz.rows[0].email, amount, plan)
      }
    }
  },

  async getPaymentHistory(businessId) {
    await ensureSquareColumns()
    const result = await query(
      'SELECT * FROM payments WHERE business_id = $1 ORDER BY created_at DESC',
      [businessId],
    )
    return result.rows
  },
}

function safeJsonParse(value) {
  if (!value || typeof value !== 'string') return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function inferPendingPlan(customerId) {
  const result = await query(
    'SELECT pending_plan, plan FROM subscriptions WHERE square_customer_id = $1 LIMIT 1',
    [customerId],
  )
  const pending = result.rows[0]?.pending_plan
  if (pending && PAID_SQUARE_PLANS.includes(pending)) return pending
  const plan = result.rows[0]?.plan
  return plan && plan !== 'free' ? plan : 'starter'
}
