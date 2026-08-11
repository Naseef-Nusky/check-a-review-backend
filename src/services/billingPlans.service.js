import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/helpers.js'
import { squareService } from './square.service.js'

const DEFAULT_PLANS = [
  {
    key: 'starter',
    name: 'Starter',
    amountCents: Number(env.SQUARE_STARTER_AMOUNT_CENTS || 2900),
    currency: env.SQUARE_CURRENCY || 'USD',
    cadence: 'MONTHLY',
    squarePlanId: env.SQUARE_STARTER_PLAN_ID || null,
    squareVariationId: null,
  },
  {
    key: 'premium',
    name: 'Premium',
    amountCents: Number(env.SQUARE_PREMIUM_AMOUNT_CENTS || 19900),
    currency: env.SQUARE_CURRENCY || 'USD',
    cadence: 'MONTHLY',
    squarePlanId: env.SQUARE_PREMIUM_PLAN_ID || null,
    squareVariationId: null,
  },
]

let tableReady = false

async function ensureBillingPlansTable() {
  if (tableReady) return
  await query(`
    CREATE TABLE IF NOT EXISTS billing_plans (
      plan_key VARCHAR(20) PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      cadence VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      square_plan_id VARCHAR(255),
      square_variation_id VARCHAR(255),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  for (const plan of DEFAULT_PLANS) {
    await query(
      `INSERT INTO billing_plans (
         plan_key, name, amount_cents, currency, cadence, square_plan_id, square_variation_id
       ) VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULL)
       ON CONFLICT (plan_key) DO NOTHING`,
      [
        plan.key,
        plan.name,
        plan.amountCents,
        plan.currency,
        plan.cadence,
        plan.squarePlanId,
      ],
    )
  }

  // Backfill env plan IDs only when DB still empty for that plan.
  if (env.SQUARE_STARTER_PLAN_ID) {
    await query(
      `UPDATE billing_plans
       SET square_plan_id = COALESCE(NULLIF(square_plan_id, ''), $1),
           updated_at = NOW()
       WHERE plan_key = 'starter'`,
      [env.SQUARE_STARTER_PLAN_ID],
    )
  }
  if (env.SQUARE_PREMIUM_PLAN_ID) {
    await query(
      `UPDATE billing_plans
       SET square_plan_id = COALESCE(NULLIF(square_plan_id, ''), $1),
           updated_at = NOW()
       WHERE plan_key = 'premium'`,
      [env.SQUARE_PREMIUM_PLAN_ID],
    )
  }

  tableReady = true
}

function mapPlan(row) {
  if (!row) return null
  return {
    key: row.plan_key,
    name: row.name,
    amountCents: Number(row.amount_cents),
    currency: row.currency,
    cadence: row.cadence,
    active: row.active,
    squarePlanId: row.square_plan_id || null,
    squareVariationId: row.square_variation_id || null,
    updatedAt: row.updated_at,
    priceLabel: `$${(Number(row.amount_cents) / 100).toFixed(2)}`,
    synced: Boolean(row.square_plan_id),
  }
}

export const billingPlansService = {
  async list() {
    await ensureBillingPlansTable()
    const result = await query(
      `SELECT * FROM billing_plans
       WHERE plan_key IN ('starter', 'premium')
       ORDER BY CASE plan_key WHEN 'starter' THEN 0 ELSE 1 END`,
    )
    return result.rows.map(mapPlan)
  },

  async getByKey(planKey) {
    await ensureBillingPlansTable()
    if (!['starter', 'premium'].includes(planKey)) {
      throw new AppError('Plan key must be starter or premium', 400)
    }
    const result = await query('SELECT * FROM billing_plans WHERE plan_key = $1', [planKey])
    if (!result.rows[0]) throw new AppError('Billing plan not found', 404)
    return mapPlan(result.rows[0])
  },

  async update(planKey, data = {}) {
    await ensureBillingPlansTable()
    const existing = await this.getByKey(planKey)

    const name = data.name !== undefined ? String(data.name).trim() : existing.name
    const amountCents =
      data.amountCents !== undefined ? Number(data.amountCents) : existing.amountCents
    const currency = data.currency !== undefined ? String(data.currency).trim().toUpperCase() : existing.currency
    const cadence = data.cadence !== undefined ? String(data.cadence).trim().toUpperCase() : existing.cadence
    const active = data.active !== undefined ? Boolean(data.active) : existing.active

    if (!name) throw new AppError('Plan name is required', 400)
    if (!Number.isFinite(amountCents) || amountCents < 0) {
      throw new AppError('amountCents must be a non-negative number', 400)
    }
    if (!['MONTHLY', 'YEARLY', 'WEEKLY'].includes(cadence)) {
      throw new AppError('cadence must be MONTHLY, YEARLY, or WEEKLY', 400)
    }

    const result = await query(
      `UPDATE billing_plans
       SET name = $1,
           amount_cents = $2,
           currency = $3,
           cadence = $4,
           active = $5,
           updated_at = NOW()
       WHERE plan_key = $6
       RETURNING *`,
      [name, Math.round(amountCents), currency || 'USD', cadence, active, planKey],
    )
    return mapPlan(result.rows[0])
  },

  async syncToSquare(planKey) {
    await ensureBillingPlansTable()
    if (!squareService.hasCredentials()) {
      throw new AppError('Square access token / location is not configured in .env', 503)
    }

    const plan = await this.getByKey(planKey)
    const synced = await squareService.upsertSubscriptionPlan({
      key: plan.key,
      name: plan.name,
      amountCents: plan.amountCents,
      currency: plan.currency,
      cadence: plan.cadence,
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
    const keys = ['starter', 'premium']
    const out = []
    for (const key of keys) {
      out.push(await this.syncToSquare(key))
    }
    return out
  },
}
