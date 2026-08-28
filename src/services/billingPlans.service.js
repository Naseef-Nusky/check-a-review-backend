import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/helpers.js'
import { squareService } from './square.service.js'
import { CATALOG_VERSION, PAID_SQUARE_PLANS, PLAN_CATALOG, formatLimit, getPlan, isUnlimited } from '../config/planCatalog.js'

const BILLABLE_KEYS = ['starter', 'plus', 'premium']
const BILLING_CADENCE = 'MONTHLY'

let tableReady = false

async function ensureBillingPlansTable() {
  if (tableReady) return
  await query(`
    CREATE TABLE IF NOT EXISTS billing_plans (
      plan_key VARCHAR(20) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      currency VARCHAR(10) NOT NULL DEFAULT 'GBP',
      cadence VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      square_plan_id VARCHAR(255),
      square_variation_id VARCHAR(255),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS monthly_amount_cents INTEGER`)
  await query(`ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS per_domain BOOLEAN NOT NULL DEFAULT FALSE`)
  await query(`ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS trial_days INTEGER NOT NULL DEFAULT 0`)
  await query(`ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS checkout_mode VARCHAR(20) NOT NULL DEFAULT 'buy'`)
  await query(`ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS invitations_per_month INTEGER`)
  await query(`ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS widgets_limit INTEGER`)
  await query(`ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS users_limit INTEGER`)
  await query(`ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS domains_limit INTEGER`)
  await query(`ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS integrations_limit INTEGER`)
  await query(`ALTER TABLE billing_plans ADD COLUMN IF NOT EXISTS catalog_version INTEGER NOT NULL DEFAULT 0`)

  for (const key of BILLABLE_KEYS) {
    const catalog = PLAN_CATALOG[key]
    await query(
      `INSERT INTO billing_plans (
         plan_key, name, amount_cents, monthly_amount_cents, currency, cadence, active,
         per_domain, trial_days, checkout_mode,
         invitations_per_month, widgets_limit, users_limit, domains_limit, integrations_limit,
         catalog_version
       ) VALUES (
         $1, $2, $3, $4, 'GBP', $5, $6,
         $7, $8, $9,
         $10, $11, $12, $13, $14,
         $15
       )
       ON CONFLICT (plan_key) DO NOTHING`,
      [
        catalog.key,
        catalog.name,
        catalog.amountCents,
        catalog.monthlyAmountCents,
        catalog.cadence,
        catalog.checkout !== 'sales',
        catalog.perDomain,
        catalog.trialDays,
        catalog.checkout,
        finiteOrNull(catalog.invitationsPerMonth),
        finiteOrNull(catalog.widgets),
        finiteOrNull(catalog.users),
        finiteOrNull(catalog.domains),
        finiteOrNull(catalog.integrations),
        CATALOG_VERSION,
      ],
    )
  }

  for (const key of BILLABLE_KEYS) {
    const catalog = PLAN_CATALOG[key]
    await query(
      `UPDATE billing_plans
       SET name = $1,
           amount_cents = $2,
           monthly_amount_cents = $3,
           cadence = $4,
           active = $5,
           per_domain = $6,
           trial_days = $7,
           checkout_mode = $8,
           invitations_per_month = $9,
           widgets_limit = $10,
           users_limit = $11,
           domains_limit = $12,
           integrations_limit = $13,
           catalog_version = $14,
           updated_at = NOW()
       WHERE plan_key = $15 AND catalog_version < $14`,
      [
        catalog.name,
        catalog.amountCents,
        catalog.monthlyAmountCents,
        catalog.cadence,
        catalog.checkout !== 'sales',
        catalog.perDomain,
        catalog.trialDays,
        catalog.checkout,
        finiteOrNull(catalog.invitationsPerMonth),
        finiteOrNull(catalog.widgets),
        finiteOrNull(catalog.users),
        finiteOrNull(catalog.domains),
        finiteOrNull(catalog.integrations),
        CATALOG_VERSION,
        catalog.key,
      ],
    )
  }

  if (env.SQUARE_STARTER_PLAN_ID) {
    await query(
      `UPDATE billing_plans
       SET square_plan_id = COALESCE(NULLIF(square_plan_id, ''), $1), updated_at = NOW()
       WHERE plan_key = 'starter'`,
      [env.SQUARE_STARTER_PLAN_ID],
    )
  }
  if (env.SQUARE_PREMIUM_PLAN_ID) {
    await query(
      `UPDATE billing_plans
       SET square_plan_id = COALESCE(NULLIF(square_plan_id, ''), $1), updated_at = NOW()
       WHERE plan_key = 'premium'`,
      [env.SQUARE_PREMIUM_PLAN_ID],
    )
  }

  await query(`DELETE FROM billing_plans WHERE plan_key = 'enterprise'`)

  // Plans are monthly-only; fix legacy rows (yearly cadence or 12× monthly amount on any plan).
  await query(
    `UPDATE billing_plans
     SET cadence = $1,
         amount_cents = monthly_amount_cents,
         per_domain = FALSE,
         square_variation_id = NULL,
         updated_at = NOW()
     WHERE monthly_amount_cents IS NOT NULL
       AND (
         cadence IS DISTINCT FROM $1
         OR amount_cents IS DISTINCT FROM monthly_amount_cents
         OR per_domain = TRUE
       )`,
    [BILLING_CADENCE],
  )

  tableReady = true
}

function finiteOrNull(value) {
  return isUnlimited(value) ? null : Math.round(Number(value))
}

function fromDbLimit(value, fallback) {
  if (value == null) return UNLIMITED_FALLBACK(fallback)
  return Number(value)
}

function UNLIMITED_FALLBACK(fallback) {
  return isUnlimited(fallback) ? Number.POSITIVE_INFINITY : fallback
}

function formatCurrencyAmount(cents, currency) {
  const code = String(currency || 'GBP').toUpperCase()
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 0,
    }).format((Number(cents) || 0) / 100)
  } catch {
    return `${code} ${((Number(cents) || 0) / 100).toFixed(0)}`
  }
}

function computeMonthlyChargeCents(plan) {
  return Math.round(Number(plan.monthlyAmountCents ?? plan.amountCents ?? 0))
}

function mapPlan(row) {
  if (!row) return null
  const catalog = getPlan(row.plan_key)
  const monthlyAmountCents = Number(row.monthly_amount_cents ?? catalog.monthlyAmountCents)
  const invitations = fromDbLimit(row.invitations_per_month, catalog.invitationsPerMonth)
  const widgets = fromDbLimit(row.widgets_limit, catalog.widgets)
  const users = fromDbLimit(row.users_limit, catalog.users)
  const domains = fromDbLimit(row.domains_limit, catalog.domains)
  const integrations = fromDbLimit(row.integrations_limit, catalog.integrations)

  return {
    key: row.plan_key,
    name: row.name,
    amountCents: monthlyAmountCents,
    monthlyAmountCents,
    monthlyDollars: monthlyAmountCents / 100,
    currency: String(row.currency || 'GBP').toUpperCase(),
    cadence: BILLING_CADENCE,
    active: row.active,
    perDomain: false,
    trialDays: Number(row.trial_days || 0),
    checkout: row.checkout_mode || catalog.checkout,
    invitationsPerMonth: invitations,
    widgets,
    users,
    domains,
    integrations,
    squarePlanId: row.square_plan_id || null,
    squareVariationId: row.square_variation_id || null,
    updatedAt: row.updated_at,
    priceLabel:
      catalog.checkout === 'sales'
        ? 'Contact sales'
        : formatCurrencyAmount(monthlyAmountCents, String(row.currency || 'GBP').toUpperCase()),
    periodLabel: catalog.periodLabel,
    billingPeriodLabel: `${formatCurrencyAmount(monthlyAmountCents, String(row.currency || 'GBP').toUpperCase())} / month`,
    synced: Boolean(row.square_plan_id),
    limitsLabel: {
      invitations: formatLimit(invitations),
      widgets: formatLimit(widgets),
      users: formatLimit(users),
      domains: formatLimit(domains),
      integrations: isUnlimited(integrations) ? 'All' : formatLimit(integrations),
    },
    tagline: catalog.tagline,
    features: catalog.features,
    notes: catalog.notes,
  }
}

export const billingPlansService = {
  async list() {
    await ensureBillingPlansTable()
    const result = await query(
      `SELECT * FROM billing_plans
       WHERE plan_key IN ('starter', 'plus', 'premium')
       ORDER BY CASE plan_key
         WHEN 'starter' THEN 0
         WHEN 'plus' THEN 1
         WHEN 'premium' THEN 2
         ELSE 3
       END`,
    )
    return result.rows.map(mapPlan)
  },

  async getByKey(planKey) {
    await ensureBillingPlansTable()
    if (!BILLABLE_KEYS.includes(planKey)) {
      throw new AppError('Plan key must be starter, plus, or premium', 400)
    }
    const result = await query('SELECT * FROM billing_plans WHERE plan_key = $1', [planKey])
    if (!result.rows[0]) throw new AppError('Billing plan not found', 404)
    return mapPlan(result.rows[0])
  },

  async update(planKey, data = {}) {
    await ensureBillingPlansTable()
    const existing = await this.getByKey(planKey)
    const catalog = getPlan(planKey)

    const name = data.name !== undefined ? String(data.name).trim() : existing.name
    let monthlyAmountCents = existing.monthlyAmountCents
    if (data.amountDollars !== undefined && data.amountDollars !== '') {
      monthlyAmountCents = Math.round(Number(data.amountDollars) * 100)
    } else if (data.monthlyAmountCents !== undefined) {
      monthlyAmountCents = Number(data.monthlyAmountCents)
    }

    const currency = data.currency !== undefined ? String(data.currency).trim().toUpperCase() : existing.currency
    const active = data.active !== undefined ? Boolean(data.active) : existing.active
    const amountCents = Math.round(monthlyAmountCents)

    if (!name) throw new AppError('Plan name is required', 400)
    if (!Number.isFinite(monthlyAmountCents) || monthlyAmountCents < 0) {
      throw new AppError('Monthly price must be a non-negative dollar amount', 400)
    }
    if (!currency || currency.length !== 3) {
      throw new AppError('currency must be a 3-letter code like GBP or USD', 400)
    }

    const parseLimitField = (input, current) => {
      if (input === undefined) return finiteOrNull(current)
      const text = String(input).trim().toLowerCase()
      if (!text || ['unlimited', 'all', 'inf'].includes(text)) return null
      const n = Number(input)
      return Number.isFinite(n) ? Math.round(n) : finiteOrNull(current)
    }

    const result = await query(
      `UPDATE billing_plans
       SET name = $1,
           amount_cents = $2,
           monthly_amount_cents = $3,
           currency = $4,
           cadence = $5,
           active = $6,
           invitations_per_month = $7,
           widgets_limit = $8,
           users_limit = $9,
           domains_limit = $10,
           integrations_limit = $11,
           catalog_version = $12,
           updated_at = NOW()
       WHERE plan_key = $13
       RETURNING *`,
      [
        name,
        amountCents,
        monthlyAmountCents,
        currency,
        BILLING_CADENCE,
        active,
        parseLimitField(data.invitationsPerMonth, existing.invitationsPerMonth),
        parseLimitField(data.widgets, existing.widgets),
        parseLimitField(data.users, existing.users),
        parseLimitField(data.domains, existing.domains),
        parseLimitField(data.integrations, existing.integrations),
        CATALOG_VERSION,
        planKey,
      ],
    )
    return mapPlan(result.rows[0])
  },

  async syncToSquare(planKey) {
    await ensureBillingPlansTable()
    if (!PAID_SQUARE_PLANS.includes(planKey)) {
      throw new AppError('Only Starter, Plus, and Premium can be synced to Square', 400)
    }
    if (!squareService.hasCredentials()) {
      throw new AppError('Square access token / location is not configured in .env', 503)
    }

    const plan = await this.getByKey(planKey)
    if (!plan.active) throw new AppError(`Plan "${planKey}" is inactive`, 400)
    if (plan.cadence !== BILLING_CADENCE) {
      throw new AppError(`Plan "${planKey}" must use monthly billing before syncing to Square`, 400)
    }
    const synced = await squareService.upsertSubscriptionPlan({
      key: plan.key,
      name: plan.name,
      amountCents: plan.monthlyAmountCents,
      currency: plan.currency,
      cadence: BILLING_CADENCE,
      trialDays: plan.trialDays,
      existingPlanId: plan.squarePlanId,
      existingVariationId: plan.squareVariationId,
    })

    const result = await query(
      `UPDATE billing_plans
       SET square_plan_id = $1,
           square_variation_id = $2,
           updated_at = NOW()
       WHERE plan_key = $3
       RETURNING *`,
      [synced.planId, synced.variationId, planKey],
    )
    return mapPlan(result.rows[0])
  },

  async syncAllToSquare() {
    const out = []
    for (const key of PAID_SQUARE_PLANS) {
      out.push(await this.syncToSquare(key))
    }
    return out
  },

  computeMonthlyChargeCents(plan) {
    return computeMonthlyChargeCents(plan)
  },
}
