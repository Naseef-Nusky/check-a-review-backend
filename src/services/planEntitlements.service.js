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

export async function ensureAssignablePlans() {
  await query(`
    DO $$
    BEGIN
      ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
      ALTER TABLE subscriptions
        ADD CONSTRAINT subscriptions_plan_check
        CHECK (plan IN ('free', 'starter', 'plus', 'premium', 'enterprise'));
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END $$;
  `)
}

export async function getBusinessPlanKey(businessId) {
  const result = await query('SELECT plan FROM subscriptions WHERE business_id = $1', [businessId])
  const plan = String(result.rows[0]?.plan || 'free').toLowerCase()
  return ASSIGNABLE_PLANS.includes(plan) ? plan : 'free'
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
  const planKey = await getBusinessPlanKey(businessId)
  const plan = getPlan(planKey)
  const [invitationsUsed, usersUsed, domainsUsed] = await Promise.all([
    countInvitationsThisMonth(businessId),
    countUsers(businessId).catch(() => 1),
    countDomains(businessId).catch(() => 0),
  ])

  return {
    plan: planKey,
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
