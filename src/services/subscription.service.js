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
  await query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ`)
  await query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS renewal_reminder_period_end TIMESTAMPTZ`)
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS square_payment_id VARCHAR(255)`)
  await query(`ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'GBP'`)
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

function parseSquareDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function extractPeriodEnd(obj = {}) {
  return parseSquareDate(
    obj.charged_through_date ||
      obj.chargedThroughDate ||
      obj.current_period_end ||
      obj.currentPeriodEnd,
  )
}

function addMonths(from, months = 1) {
  const date = new Date(from)
  date.setMonth(date.getMonth() + Number(months || 0))
  return date
}

function addDays(from, days) {
  const date = new Date(from)
  date.setDate(date.getDate() + Number(days || 0))
  return date
}

async function findSubscriptionRow({ customerId, subscriptionId, businessId } = {}) {
  if (businessId) {
    const byBusiness = await query('SELECT * FROM subscriptions WHERE business_id = $1 LIMIT 1', [businessId])
    if (byBusiness.rows[0]) return byBusiness.rows[0]
  }
  if (subscriptionId) {
    const bySub = await query('SELECT * FROM subscriptions WHERE square_subscription_id = $1 LIMIT 1', [subscriptionId])
    if (bySub.rows[0]) return bySub.rows[0]
  }
  if (customerId) {
    const byCustomer = await query('SELECT * FROM subscriptions WHERE square_customer_id = $1 LIMIT 1', [customerId])
    if (byCustomer.rows[0]) return byCustomer.rows[0]
  }
  return null
}

async function ownerEmailForBusiness(businessId) {
  const result = await query(
    'SELECT u.email FROM businesses b JOIN users u ON u.id = b.user_id WHERE b.id = $1',
    [businessId],
  )
  return result.rows[0]?.email || null
}

async function setPeriodEnd(businessId, periodEnd) {
  if (!businessId || !periodEnd) return
  await query(
    `UPDATE subscriptions
     SET current_period_end = $1, updated_at = NOW()
     WHERE business_id = $2`,
    [periodEnd, businessId],
  )
}

export const subscriptionService = {
  async getByBusiness(businessId) {
    await ensureSquareColumns()
    const result = await query('SELECT * FROM subscriptions WHERE business_id = $1', [businessId])
    const row = result.rows[0] || { plan: 'free', status: 'active' }

    if (row.square_subscription_id && squareService.hasCredentials()) {
      try {
        const remote = await squareService.getSubscription(row.square_subscription_id)
        const periodEnd = extractPeriodEnd(remote || {})
        if (periodEnd) {
          await setPeriodEnd(businessId, periodEnd)
          row.current_period_end = periodEnd
        }
      } catch (err) {
        console.error('Could not refresh Square subscription:', err.message)
      }
    }

    const entitlements = await getEntitlements(businessId)
    const billingPlans = await billingPlansService.list().catch(() => [])
    return {
      ...row,
      entitlements,
      catalog: billingPlans,
      salesEmail: env.SALES_EMAIL,
      autoRenew: Boolean(row.square_subscription_id && ['active', 'trialing', 'past_due'].includes(row.status)),
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

    const trialDays = Number(planRow.trialDays || planRow.trial_days || 0)
    const expectedEnd = addMonths(addDays(new Date(), trialDays), 1)
    await query(
      `UPDATE subscriptions
       SET pending_plan = $1,
           current_period_end = COALESCE(current_period_end, $3),
           updated_at = NOW()
       WHERE business_id = $2`,
      [plan, businessId, expectedEnd],
    )

    return {
      sessionId: link.id,
      url: link.url,
      sandboxMode: link.sandboxMode,
      plan,
    }
  },

  /**
   * Charge via Square Web Payments card token (in-app checkout).
   * Prefer this over Payment Links in sandbox — Payment Links only open the testing panel.
   */
  async payWithCard(businessId, userId, plan, sourceId, verificationToken) {
    await ensureSquareColumns()
    if (!PAID_SQUARE_PLANS.includes(plan)) {
      throw new AppError('This plan is quoted by sales. Use Book demo instead of checkout.', 400)
    }
    if (!squareService.hasCredentials()) {
      throw new AppError('Square billing is not configured yet. Add Square sandbox keys to .env.', 503)
    }
    const clientConfig = squareService.getClientConfig()
    if (!clientConfig.cardPaymentsEnabled) {
      throw new AppError(
        'Add SQUARE_APPLICATION_ID to the backend .env (from Square Developer Dashboard → your app → Application ID).',
        503,
      )
    }
    if (!sourceId) throw new AppError('Card token is required', 400)

    const planRow = await billingPlansService.getByKey(plan)
    if (!planRow.active) throw new AppError(`Plan "${plan}" is inactive`, 400)
    if (!planRow.squareVariationId && !planRow.squarePlanId) {
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
    const previousSubscriptionId = sub.rows[0]?.square_subscription_id || null

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

    const created = await squareService.createCardSubscription({
      customerId,
      sourceId,
      verificationToken,
      planVariationId: planRow.squareVariationId || planRow.squarePlanId,
      businessId,
      plan,
    })

    if (previousSubscriptionId && previousSubscriptionId !== created.subscriptionId) {
      try {
        await squareService.cancelSubscription(previousSubscriptionId)
      } catch (err) {
        console.error('Failed to cancel previous Square subscription:', err.message)
      }
    }

    const trialDays = Number(planRow.trialDays || planRow.trial_days || 0)
    const status = trialDays > 0 ? 'trialing' : 'active'
    const periodEnd = addMonths(addDays(new Date(), trialDays), 1)

    await query(
      `UPDATE subscriptions
       SET plan = $1,
           status = $2,
           pending_plan = NULL,
           square_customer_id = $3,
           square_subscription_id = $4,
           current_period_end = $5,
           updated_at = NOW()
       WHERE business_id = $6`,
      [plan, status, customerId, created.subscriptionId, periodEnd, businessId],
    )

    const chargeAmount = trialDays > 0 ? 0 : amountCents
    if (chargeAmount > 0 || trialDays > 0) {
      await this.recordSuccessfulCharge({
        businessId,
        paymentId: `card-sub-${created.subscriptionId}`,
        amount: chargeAmount,
        currency: planRow.currency || 'GBP',
        plan,
        nextBillingDate: periodEnd,
      })
    }

    return this.getByBusiness(businessId)
  },

  /**
   * Called when Square redirects back to ?checkout=success.
   * Payment-link checkouts often create a *new* Square customer, so webhooks
   * may not match our stored square_customer_id. Applying pending_plan here
   * completes the upgrade for the authenticated business owner.
   */
  async confirmCheckout(businessId, userId) {
    await ensureSquareColumns()
    await assertBusinessOwner(businessId, userId)

    const sub = await query('SELECT * FROM subscriptions WHERE business_id = $1 LIMIT 1', [businessId])
    const row = sub.rows[0]
    if (!row) throw new AppError('Subscription not found', 404)

    const pending = row.pending_plan
    if (!pending || !PAID_SQUARE_PLANS.includes(pending)) {
      return this.getByBusiness(businessId)
    }

    const periodEnd = row.current_period_end || addMonths(new Date(), 1)
    await query(
      `UPDATE subscriptions
       SET plan = $1,
           status = 'active',
           pending_plan = NULL,
           current_period_end = COALESCE(current_period_end, $2),
           updated_at = NOW()
       WHERE business_id = $3`,
      [pending, periodEnd, businessId],
    )

    let amountCents = 0
    let currency = 'GBP'
    try {
      const planRow = await billingPlansService.getByKey(pending)
      amountCents = Number(planRow?.amountCents || 0)
      currency = planRow?.currency || 'GBP'
    } catch {
      // catalog lookup is best-effort for CRM payment history
    }

    await this.recordSuccessfulCharge({
      businessId,
      paymentId: `portal-confirm-${businessId}-${pending}-${Date.now()}`,
      amount: amountCents,
      currency,
      plan: pending,
      nextBillingDate: periodEnd,
    })

    const email = await ownerEmailForBusiness(businessId)
    if (email) {
      await emailService.sendSubscriptionConfirmation(email, pending, {
        nextBillingDate: periodEnd,
      })
    }

    return this.getByBusiness(businessId)
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
           pending_plan = NULL,
           updated_at = NOW()
       WHERE business_id = $1
       RETURNING *`,
      [businessId],
    )
    return result.rows[0]
  },

  async updatePaymentMethod(businessId, userId, sourceId, verificationToken) {
    await ensureSquareColumns()
    await assertBusinessOwner(businessId, userId)

    if (!squareService.hasCredentials()) {
      throw new AppError('Square billing is not configured yet.', 503)
    }
    if (!squareService.getClientConfig().cardPaymentsEnabled) {
      throw new AppError(
        'Add SQUARE_APPLICATION_ID to the backend .env (from Square Developer Dashboard → your app → Application ID).',
        503,
      )
    }
    if (!sourceId) throw new AppError('Card token is required', 400)

    const sub = await query('SELECT * FROM subscriptions WHERE business_id = $1 LIMIT 1', [businessId])
    const row = sub.rows[0]
    if (!row) throw new AppError('Subscription not found', 404)
    if (!row.square_subscription_id) {
      throw new AppError('No active paid subscription to update. Choose a plan and pay first.', 400)
    }

    let customerId = row.square_customer_id
    if (!customerId) {
      const business = await query(
        'SELECT b.*, u.email, u.name FROM businesses b JOIN users u ON u.id = b.user_id WHERE b.id = $1',
        [businessId],
      )
      if (business.rows.length === 0) throw new AppError('Business not found', 404)
      const customer = await squareService.createCustomer(business.rows[0].email, business.rows[0].name)
      customerId = customer.id
      await query(
        'UPDATE subscriptions SET square_customer_id = $1, updated_at = NOW() WHERE business_id = $2',
        [customerId, businessId],
      )
    }

    const card = await squareService.createCard({
      customerId,
      sourceId,
      verificationToken,
      businessId,
      plan: row.plan,
    })

    await squareService.updateSubscriptionCard(row.square_subscription_id, card.id)

    // If renewal previously failed, clear past_due after card update so user can keep features.
    if (row.status === 'past_due') {
      await query(
        `UPDATE subscriptions
         SET status = 'active', updated_at = NOW()
         WHERE business_id = $1`,
        [businessId],
      )
    }

    return this.getByBusiness(businessId)
  },

  async handleWebhook(event) {
    await ensureSquareColumns()
    const type = String(event?.type || '')
    const obj = eventObject(event)

    if (type === 'subscription.created' || type === 'subscription.updated') {
      await this.applySquareSubscription(obj, { created: type === 'subscription.created' })
      return
    }

    if (type === 'invoice.payment_made') {
      await this.handleInvoicePaid(obj)
      return
    }

    if (
      type === 'invoice.scheduled_charge_failed' ||
      type === 'invoice.payment_failed' ||
      type === 'invoice.payment_overdue'
    ) {
      await this.handleInvoiceFailed(obj)
      return
    }

    if (type === 'payment.updated' || type === 'payment.created') {
      await this.handlePaymentEvent(obj)
    }
  },

  async applySquareSubscription(obj, { created = false } = {}) {
    const subscriptionId = obj.id
    const customerId = obj.customer_id || obj.customerId
    const status = String(obj.status || '').toUpperCase()
    const note = safeJsonParse(obj.note) || safeJsonParse(obj.source?.name)
    const plan = note?.plan && PAID_SQUARE_PLANS.includes(note.plan) ? note.plan : null
    const periodEnd = extractPeriodEnd(obj)

    if (!customerId && !subscriptionId) return

    if (status === 'CANCELED' || status === 'DEACTIVATED') {
      await query(
        `UPDATE subscriptions
         SET plan = 'free',
             status = 'cancelled',
             square_subscription_id = NULL,
             pending_plan = NULL,
             updated_at = NOW()
         WHERE square_customer_id = $1 OR square_subscription_id = $2`,
        [customerId || '', subscriptionId || ''],
      )
      return
    }

    const nextPlan = plan || (await inferPendingPlan(customerId))
    const localStatus = status === 'PAUSED' ? 'past_due' : status === 'PENDING' ? 'trialing' : 'active'

    await query(
      `UPDATE subscriptions
       SET plan = COALESCE($1, plan),
           pending_plan = NULL,
           square_subscription_id = COALESCE($2, square_subscription_id),
           square_customer_id = COALESCE(square_customer_id, $3),
           status = $4,
           current_period_end = COALESCE($5, current_period_end),
           updated_at = NOW()
       WHERE square_customer_id = $3 OR square_subscription_id = $2`,
      [nextPlan, subscriptionId, customerId, localStatus, periodEnd],
    )

    if (created && nextPlan && localStatus !== 'past_due') {
      const row = await findSubscriptionRow({ customerId, subscriptionId })
      const email = row ? await ownerEmailForBusiness(row.business_id) : null
      if (email) {
        await emailService.sendSubscriptionConfirmation(email, nextPlan, {
          nextBillingDate: periodEnd || row?.current_period_end,
        })
      }
    }
  },

  async handleInvoicePaid(invoice) {
    const subscriptionId = invoice.subscription_id || invoice.subscriptionId
    const customerId = invoice.primary_recipient?.customer_id || invoice.customer_id || invoice.customerId
    const amount = Number(
      invoice.payment_requests?.[0]?.computed_amount_money?.amount ||
        invoice.paymentRequests?.[0]?.computedAmountMoney?.amount ||
        0,
    )
    const currency =
      invoice.payment_requests?.[0]?.computed_amount_money?.currency ||
      invoice.paymentRequests?.[0]?.computedAmountMoney?.currency ||
      'GBP'
    const invoiceId = invoice.id
    if (!invoiceId) return

    const row = await findSubscriptionRow({ customerId, subscriptionId })
    if (!row) return

    const nextEnd = extractPeriodEnd(invoice) || addMonths(new Date(), 1)
    await query(
      `UPDATE subscriptions
       SET status = 'active',
           current_period_end = $1,
           updated_at = NOW()
       WHERE business_id = $2`,
      [nextEnd, row.business_id],
    )

    await this.recordSuccessfulCharge({
      businessId: row.business_id,
      paymentId: `invoice-${invoiceId}`,
      amount,
      currency,
      plan: row.plan,
      nextBillingDate: nextEnd,
    })
  },

  async handleInvoiceFailed(invoice) {
    const subscriptionId = invoice.subscription_id || invoice.subscriptionId
    const customerId = invoice.primary_recipient?.customer_id || invoice.customer_id || invoice.customerId
    const invoiceId = invoice.id || `failed-${Date.now()}`
    const row = await findSubscriptionRow({ customerId, subscriptionId })
    if (!row) return

    await query(
      `UPDATE subscriptions
       SET status = 'past_due', updated_at = NOW()
       WHERE business_id = $1`,
      [row.business_id],
    )

    const failed = await query(
      `INSERT INTO payments (business_id, square_payment_id, amount, currency, plan, status)
       VALUES ($1, $2, $3, $4, $5, 'failed')
       ON CONFLICT (square_payment_id) DO NOTHING
       RETURNING id`,
      [row.business_id, `failed-${invoiceId}`, 0, 'GBP', row.plan],
    )

    const email = await ownerEmailForBusiness(row.business_id)
    if (failed.rows[0] && email && row.plan && row.plan !== 'free') {
      await emailService.sendPaymentFailed(email, row.plan)
    }
  },

  async handlePaymentEvent(payment) {
    const paymentStatus = String(payment.status || '').toUpperCase()
    const note = safeJsonParse(payment.note)
    const customerId = payment.customer_id || payment.customerId || note?.customerId
    const businessId = note?.businessId || null
    const amount = Number(payment.amount_money?.amount || payment.amountMoney?.amount || 0)
    const currency = payment.amount_money?.currency || payment.amountMoney?.currency || 'GBP'
    const paymentId = payment.id
    if (!paymentId) return

    // Prefer businessId from payment note — Square checkout often creates a
    // new customer that does not match our stored square_customer_id.
    const row = await findSubscriptionRow({ customerId, businessId })
    if (!row) return

    if (customerId && customerId !== row.square_customer_id) {
      await query(
        `UPDATE subscriptions
         SET square_customer_id = $1, updated_at = NOW()
         WHERE business_id = $2`,
        [customerId, row.business_id],
      )
    }

    if (paymentStatus === 'FAILED' || paymentStatus === 'CANCELED') {
      await query(
        `UPDATE subscriptions SET status = 'past_due', updated_at = NOW() WHERE business_id = $1`,
        [row.business_id],
      )
      const failed = await query(
        `INSERT INTO payments (business_id, square_payment_id, amount, currency, plan, status)
         VALUES ($1, $2, $3, $4, $5, 'failed')
         ON CONFLICT (square_payment_id) DO NOTHING
         RETURNING id`,
        [row.business_id, paymentId, amount, currency, note?.plan || row.pending_plan || row.plan],
      )
      const email = await ownerEmailForBusiness(row.business_id)
      if (failed.rows[0] && email && row.plan !== 'free') {
        await emailService.sendPaymentFailed(email, note?.plan || row.plan)
      }
      return
    }

    if (paymentStatus !== 'COMPLETED') return

    const plan =
      note?.plan && PAID_SQUARE_PLANS.includes(note.plan)
        ? note.plan
        : row.pending_plan && PAID_SQUARE_PLANS.includes(row.pending_plan)
          ? row.pending_plan
          : row.plan
    const nextEnd = extractPeriodEnd(payment) || addMonths(row.current_period_end || new Date(), 1)

    if (plan && PAID_SQUARE_PLANS.includes(plan)) {
      await query(
        `UPDATE subscriptions
         SET plan = $1,
             status = 'active',
             pending_plan = NULL,
             current_period_end = $2,
             updated_at = NOW()
         WHERE business_id = $3`,
        [plan, nextEnd, row.business_id],
      )
    } else {
      await setPeriodEnd(row.business_id, nextEnd)
    }

    await this.recordSuccessfulCharge({
      businessId: row.business_id,
      paymentId,
      amount,
      currency,
      plan,
      nextBillingDate: nextEnd,
    })
  },

  async recordSuccessfulCharge({ businessId, paymentId, amount, currency, plan, nextBillingDate }) {
    const inserted = await query(
      `INSERT INTO payments (business_id, square_payment_id, amount, currency, plan, status)
       VALUES ($1, $2, $3, $4, $5, 'succeeded')
       ON CONFLICT (square_payment_id) DO NOTHING
       RETURNING id`,
      [businessId, paymentId, amount, currency || 'GBP', plan || 'subscription'],
    )
    if (!inserted.rows[0]) return

    const duplicateNotify = await query(
      `SELECT id FROM payments
       WHERE business_id = $1
         AND status = 'succeeded'
         AND id <> $2
         AND created_at > NOW() - INTERVAL '15 minutes'
       LIMIT 1`,
      [businessId, inserted.rows[0].id],
    )
    if (duplicateNotify.rows[0]) return

    const prior = await query(
      `SELECT COUNT(*)::int AS count
       FROM payments
       WHERE business_id = $1 AND status = 'succeeded'`,
      [businessId],
    )
    const isRenewal = Number(prior.rows[0]?.count || 0) > 1
    const email = await ownerEmailForBusiness(businessId)
    if (!email || !(amount > 0)) return

    if (isRenewal) {
      await emailService.sendSubscriptionRenewed(email, plan, {
        amount,
        currency,
        nextBillingDate,
      })
      await emailService.sendPaymentReceipt(email, amount, plan, { currency, renewal: true })
    } else {
      await emailService.sendPaymentReceipt(email, amount, plan, { currency })
    }
  },

  async processRenewalReminders() {
    await ensureSquareColumns()
    const due = await query(
      `SELECT s.*, u.email
       FROM subscriptions s
       JOIN businesses b ON b.id = s.business_id
       JOIN users u ON u.id = b.user_id
       WHERE s.plan <> 'free'
         AND s.status IN ('active', 'trialing')
         AND s.current_period_end IS NOT NULL
         AND s.current_period_end > NOW()
         AND s.current_period_end <= NOW() + INTERVAL '7 days'
         AND (s.renewal_reminder_period_end IS DISTINCT FROM s.current_period_end)`,
    )

    for (const row of due.rows) {
      try {
        await emailService.sendRenewalReminder(row.email, row.plan, {
          nextBillingDate: row.current_period_end,
        })
        await query(
          `UPDATE subscriptions
           SET renewal_reminder_period_end = current_period_end, updated_at = NOW()
           WHERE id = $1`,
          [row.id],
        )
      } catch (err) {
        console.error('Renewal reminder failed:', err.message)
      }
    }

    return due.rows.length
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
