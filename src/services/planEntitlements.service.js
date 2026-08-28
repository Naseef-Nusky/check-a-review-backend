import { query } from '../db/pool.js'
import {
  ASSIGNABLE_PLANS,
  PLAN_CATALOG,
  allowedIntegrationsForPlan,
  allowedWidgetsForPlan,
  formatLimit,
  getPlan,
  isUnlimited,
} from '../config/planCatalog.js'

export const PAST_DUE_GRACE_DAYS = 21

async function ensurePastDueColumn() {
  await query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ`)
  await query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS past_due_notice_day7_at TIMESTAMPTZ`)
  await query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS past_due_notice_day14_at TIMESTAMPTZ`)
  await query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS past_due_notice_day20_at TIMESTAMPTZ`)
  await query(`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS past_due_grace_ended_notice_at TIMESTAMPTZ`)
  await query(
    `UPDATE subscriptions
     SET past_due_since = COALESCE(past_due_since, updated_at, NOW())
     WHERE status = 'past_due' AND past_due_since IS NULL`,
  )
}

export function getGraceDaysElapsed(pastDueSince) {
  if (!pastDueSince) return 0
  const since = new Date(pastDueSince)
  if (Number.isNaN(since.getTime())) return 0
  const ms = Date.now() - since.getTime()
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}

function addDays(from, days) {
  const date = new Date(from)
  date.setDate(date.getDate() + Number(days || 0))
  return date
}

function getGraceState(pastDueSince) {
  if (!pastDueSince) {
    return { graceExpired: true, graceEndsAt: null, graceDaysRemaining: 0 }
  }

  const graceEndsAt = addDays(pastDueSince, PAST_DUE_GRACE_DAYS)
  const now = new Date()
  const graceExpired = now >= graceEndsAt
  const msRemaining = graceEndsAt.getTime() - now.getTime()
  const graceDaysRemaining = graceExpired ? 0 : Math.max(1, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)))

  return { graceExpired, graceEndsAt, graceDaysRemaining }
}

export async function ensureAssignablePlans() {
  await query(`
    UPDATE subscriptions SET plan = 'premium' WHERE plan = 'enterprise';
  `)
  await query(`
    UPDATE subscriptions SET pending_plan = 'premium' WHERE pending_plan = 'enterprise';
  `)
  await query(`
    DO $$
    BEGIN
      ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
      ALTER TABLE subscriptions
        ADD CONSTRAINT subscriptions_plan_check
        CHECK (plan IN ('free', 'starter', 'plus', 'premium'));
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END $$;
  `)
}

export async function getSubscriptionBillingState(businessId) {
  await ensurePastDueColumn()
  const result = await query(
    'SELECT plan, status, past_due_since FROM subscriptions WHERE business_id = $1',
    [businessId],
  )
  const row = result.rows[0] || { plan: 'free', status: 'active', past_due_since: null }
  const billingPlan = String(row.plan || 'free').toLowerCase()
  const status = String(row.status || 'active').toLowerCase()
  const billingPlanKey = ASSIGNABLE_PLANS.includes(billingPlan) ? billingPlan : 'free'
  const paymentOverdue = status === 'past_due' && billingPlanKey !== 'free'
  const grace = paymentOverdue ? getGraceState(row.past_due_since) : { graceExpired: false, graceEndsAt: null, graceDaysRemaining: 0 }
  const featuresSuspended = paymentOverdue && grace.graceExpired
  const paymentRequired = featuresSuspended
  const effectivePlan = featuresSuspended ? 'free' : billingPlanKey

  return {
    billingPlan: billingPlanKey,
    status,
    paymentOverdue,
    paymentRequired,
    featuresSuspended,
    effectivePlan,
    pastDueSince: row.past_due_since || null,
    graceEndsAt: grace.graceEndsAt,
    graceDaysRemaining: grace.graceDaysRemaining,
    graceExpired: grace.graceExpired,
  }
}

export async function getBusinessPlanKey(businessId) {
  const billing = await getSubscriptionBillingState(businessId)
  return billing.effectivePlan
}

export async function assertPaymentCurrent(businessId) {
  const billing = await getSubscriptionBillingState(businessId)
  if (!billing.paymentRequired) return billing

  const { AppError } = await import('../utils/helpers.js')
  const plan = getPlan(billing.billingPlan)
  throw new AppError(
    `Your ${plan.name} renewal payment is overdue and the ${PAST_DUE_GRACE_DAYS}-day grace period has ended. Retry payment or update your card to restore paid features.`,
    402,
    'PAYMENT_REQUIRED',
  )
}

async function countInvitationsThisMonth(businessId) {
  const result = await query(
    `SELECT COUNT(*)::int AS used
     FROM review_invitations
     WHERE business_id = $1
       AND sent_at >= date_trunc('month', NOW())`,
    [businessId],
  )
  return result.rows[0]?.used || 0
}

async function countUsers(businessId) {
  const result = await query(
    `SELECT COUNT(*)::int AS used
     FROM business_members
     WHERE business_id = $1 AND status IN ('active', 'invited')`,
    [businessId],
  )
  return result.rows[0]?.used || 0
}

async function countDomains(businessId) {
  const result = await query(
    `SELECT COUNT(*)::int AS used
     FROM business_domains
     WHERE business_id = $1 AND status = 'active'`,
    [businessId],
  )
  return result.rows[0]?.used || 0
}

function remaining(limit, used) {
  if (isUnlimited(limit)) return null
  return Math.max(0, Number(limit) - Number(used || 0))
}

export async function getEntitlements(businessId) {
  const billing = await getSubscriptionBillingState(businessId)
  const planKey = billing.effectivePlan
  const plan = getPlan(planKey)
  const [invitationsUsed, usersUsed, domainsUsed] = await Promise.all([
    countInvitationsThisMonth(businessId),
    countUsers(businessId).catch(() => 1),
    countDomains(businessId).catch(() => 0),
  ])

  return {
    plan: planKey,
    billingPlan: billing.billingPlan,
    subscriptionStatus: billing.status,
    paymentOverdue: billing.paymentOverdue,
    paymentRequired: billing.paymentRequired,
    featuresSuspended: billing.featuresSuspended,
    pastDueSince: billing.pastDueSince,
    graceEndsAt: billing.graceEndsAt,
    graceDaysRemaining: billing.graceDaysRemaining,
    graceExpired: billing.graceExpired,
    name: plan.name,
    flags: {
      marketingAssets: Boolean(plan.marketingAssets),
      brandMatch: Boolean(plan.brandMatch),
      dedicatedCsm: Boolean(plan.dedicatedCsm),
      advancedAnalytics: Boolean(plan.advancedAnalytics),
      optimizedInvites: Boolean(plan.optimizedInvites),
    },
    limits: {
      invitationsPerMonth: plan.invitationsPerMonth,
      invitationsPerMonthLabel: formatLimit(plan.invitationsPerMonth),
      widgets: plan.widgets,
      widgetsLabel: formatLimit(plan.widgets),
      users: plan.users,
      usersLabel: formatLimit(plan.users),
      domains: plan.domains,
      domainsLabel: formatLimit(plan.domains),
      integrations: plan.integrations,
      integrationsLabel: isUnlimited(plan.integrations) ? 'All' : formatLimit(plan.integrations),
    },
    usage: {
      invitationsThisMonth: invitationsUsed,
      users: usersUsed,
      domains: domainsUsed,
    },
    remaining: {
      invitations: remaining(plan.invitationsPerMonth, invitationsUsed),
      users: remaining(plan.users, usersUsed),
      domains: remaining(plan.domains, domainsUsed),
    },
    widgets: allowedWidgetsForPlan(planKey),
    integrations: allowedIntegrationsForPlan(planKey),
  }
}

export async function assertInvitationQuota(businessId) {
  await assertPaymentCurrent(businessId)
  const entitlements = await getEntitlements(businessId)
  const limit = entitlements.limits.invitationsPerMonth
  if (isUnlimited(limit)) return entitlements
  if (entitlements.usage.invitationsThisMonth >= limit) {
    const { AppError } = await import('../utils/helpers.js')
    throw new AppError(
      `Your ${entitlements.name} plan includes ${formatLimit(limit)} review invitations this month. Upgrade to send more.`,
      403,
      'INVITATION_LIMIT',
    )
  }
  return entitlements
}

export async function assertWidgetAccess(businessId, widgetId) {
  await assertPaymentCurrent(businessId)
  const planKey = await getBusinessPlanKey(businessId)
  const plan = getPlan(planKey)
  if (!plan.widgets) {
    const { AppError } = await import('../utils/helpers.js')
    throw new AppError(
      'Widgets are included from Starter. Upgrade to embed Check A Review on your website.',
      403,
      'WIDGET_PLAN',
    )
  }
  if (widgetId && !allowedWidgetsForPlan(planKey).some((item) => item.id === widgetId)) {
    const { AppError } = await import('../utils/helpers.js')
    throw new AppError(
      `The "${widgetId}" widget is not included in ${plan.name}. Upgrade to unlock more widgets.`,
      403,
      'WIDGET_LIMIT',
    )
  }
  return plan
}

export function listPublicPlans() {
  return Object.values(PLAN_CATALOG).filter((plan) => plan.key !== 'free')
}

export { PLAN_CATALOG, getPlan, formatLimit, isUnlimited }
