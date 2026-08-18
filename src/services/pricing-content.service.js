import { query } from '../db/pool.js'
import { CATALOG_VERSION, buildPricingContentFromCatalog, formatLimit, getPlan } from '../config/planCatalog.js'
import { billingPlansService } from './billingPlans.service.js'

const defaultPricingContent = buildPricingContentFromCatalog()

async function ensurePricingContentTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS business_pricing_content (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      hero_title VARCHAR(255) NOT NULL,
      hero_subtitle TEXT NOT NULL,
      billing_note TEXT NOT NULL,
      trust_badge VARCHAR(255) NOT NULL,
      logos JSONB NOT NULL DEFAULT '[]'::jsonb,
      steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      plans JSONB NOT NULL DEFAULT '[]'::jsonb,
      comparison_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      faqs JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await query(`ALTER TABLE business_pricing_content ADD COLUMN IF NOT EXISTS catalog_version INTEGER NOT NULL DEFAULT 0`)
}

function toDbPayload(data = defaultPricingContent) {
  return {
    heroTitle: data.heroTitle || defaultPricingContent.heroTitle,
    heroSubtitle: data.heroSubtitle || defaultPricingContent.heroSubtitle,
    billingNote: data.billingNote || defaultPricingContent.billingNote,
    trustBadge: data.trustBadge || defaultPricingContent.trustBadge,
    logos: JSON.stringify(Array.isArray(data.logos) ? data.logos : defaultPricingContent.logos),
    steps: JSON.stringify(Array.isArray(data.steps) ? data.steps : defaultPricingContent.steps),
    plans: JSON.stringify(Array.isArray(data.plans) ? data.plans : defaultPricingContent.plans),
    comparisonSections: JSON.stringify(
      Array.isArray(data.comparisonSections) ? data.comparisonSections : defaultPricingContent.comparisonSections,
    ),
    faqs: JSON.stringify(Array.isArray(data.faqs) ? data.faqs : defaultPricingContent.faqs),
  }
}

function mapRow(row) {
  return {
    id: row.id,
    heroTitle: row.hero_title,
    heroSubtitle: row.hero_subtitle,
    billingNote: row.billing_note,
    trustBadge: row.trust_badge,
    logos: row.logos || [],
    steps: row.steps || [],
    plans: row.plans || [],
    comparisonSections: row.comparison_sections || [],
    faqs: row.faqs || [],
    catalogVersion: Number(row.catalog_version || 0),
    updatedAt: row.updated_at,
  }
}

function normalizePricingContent(content = {}) {
  const plans = (Array.isArray(content.plans) ? content.plans : defaultPricingContent.plans).map((plan) => {
    const catalog = getPlan(plan.key)
    return {
      ...plan,
      users: plan.users || formatLimit(catalog.users),
      domains: plan.domains || formatLimit(catalog.domains),
    }
  })
  return {
    ...defaultPricingContent,
    ...content,
    plans,
    comparisonSections: Array.isArray(content.comparisonSections)
      ? content.comparisonSections
      : defaultPricingContent.comparisonSections,
  }
}

function buildBillingNoteFromPlans(existingNote, billingPlans = []) {
  const paidPlans = billingPlans.filter((plan) => plan.checkout !== 'sales' && Number(plan.monthlyAmountCents) > 0)
  const primaryCurrency = paidPlans[0]?.currency || 'GBP'
  const perDomainPlans = billingPlans.filter((plan) => plan.perDomain).map((plan) => plan.name)
  const perDomainText =
    perDomainPlans.length > 0 ? ` ${perDomainPlans.join(' and ')} are billed per domain.` : ''

  if (!String(existingNote || '').trim()) {
    return `Paid plans are priced per month and billed annually in ${primaryCurrency}.${perDomainText}`
  }

  return String(existingNote)
    .replace(/in\s+[A-Z]{3}\b/i, `in ${primaryCurrency}`)
    .replace(/Starter, Plus, and Premium synced to Square in [A-Z]{3}\.?/i, `Paid plans are billed in ${primaryCurrency}.`)
}

async function hydratePlansFromBilling(content = {}) {
  const normalized = normalizePricingContent(content)
  const billingPlans = await billingPlansService.list().catch(() => [])
  if (!billingPlans.length) return normalized

  const billingByKey = new Map(billingPlans.map((plan) => [plan.key, plan]))
  const plans = normalized.plans.map((plan) => {
    const billing = billingByKey.get(plan.key)
    if (!billing) return plan
    return {
      ...plan,
      name: billing.name || plan.name,
      price: billing.checkout === 'sales' ? 'Contact sales' : billing.priceLabel,
      period: billing.checkout === 'sales' ? '' : billing.periodLabel,
      users: billing.limitsLabel?.users || plan.users,
      domains: billing.limitsLabel?.domains || plan.domains,
    }
  })

  return {
    ...normalized,
    billingNote: buildBillingNoteFromPlans(normalized.billingNote, billingPlans),
    plans,
  }
}

async function seedDefaultPricingContent() {
  const payload = toDbPayload(defaultPricingContent)
  const result = await query(
    `INSERT INTO business_pricing_content
      (hero_title, hero_subtitle, billing_note, trust_badge, logos, steps, plans, comparison_sections, faqs, catalog_version)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)
     RETURNING *`,
    [
      payload.heroTitle,
      payload.heroSubtitle,
      payload.billingNote,
      payload.trustBadge,
      payload.logos,
      payload.steps,
      payload.plans,
      payload.comparisonSections,
      payload.faqs,
      CATALOG_VERSION,
    ],
  )
  return mapRow(result.rows[0])
}

async function overwriteWithCatalog(id) {
  const payload = toDbPayload(defaultPricingContent)
  const result = await query(
    `UPDATE business_pricing_content
     SET hero_title = $1,
         hero_subtitle = $2,
         billing_note = $3,
         trust_badge = $4,
         logos = $5::jsonb,
         steps = $6::jsonb,
         plans = $7::jsonb,
         comparison_sections = $8::jsonb,
         faqs = $9::jsonb,
         catalog_version = $10,
         updated_at = NOW()
     WHERE id = $11
     RETURNING *`,
    [
      payload.heroTitle,
      payload.heroSubtitle,
      payload.billingNote,
      payload.trustBadge,
      payload.logos,
      payload.steps,
      payload.plans,
      payload.comparisonSections,
      payload.faqs,
      CATALOG_VERSION,
      id,
    ],
  )
  return mapRow(result.rows[0])
}

export const pricingContentService = {
  async getBusinessPricingContent() {
    await ensurePricingContentTable()
    const result = await query('SELECT * FROM business_pricing_content ORDER BY updated_at DESC LIMIT 1')
    if (result.rows.length === 0) {
      return hydratePlansFromBilling(await seedDefaultPricingContent())
    }
    if (Number(result.rows[0].catalog_version || 0) < CATALOG_VERSION) {
      return hydratePlansFromBilling(await overwriteWithCatalog(result.rows[0].id))
    }
    return hydratePlansFromBilling(mapRow(result.rows[0]))
  },

  async updateBusinessPricingContent(data) {
    await ensurePricingContentTable()

    const existing = await query('SELECT id FROM business_pricing_content ORDER BY updated_at DESC LIMIT 1')
    if (existing.rows.length === 0) {
      await seedDefaultPricingContent()
      return this.updateBusinessPricingContent(data)
    }

    const merged = await hydratePlansFromBilling(data)
    const payload = toDbPayload(merged)
    const result = await query(
      `UPDATE business_pricing_content
       SET hero_title = $1,
           hero_subtitle = $2,
           billing_note = $3,
           trust_badge = $4,
           logos = $5::jsonb,
           steps = $6::jsonb,
           plans = $7::jsonb,
           comparison_sections = $8::jsonb,
           faqs = $9::jsonb,
           catalog_version = $10,
           updated_at = NOW()
       WHERE id = $11
       RETURNING *`,
      [
        payload.heroTitle,
        payload.heroSubtitle,
        payload.billingNote,
        payload.trustBadge,
        payload.logos,
        payload.steps,
        payload.plans,
        payload.comparisonSections,
        payload.faqs,
        CATALOG_VERSION,
        existing.rows[0].id,
      ],
    )

    return hydratePlansFromBilling(mapRow(result.rows[0]))
  },
}

export { defaultPricingContent }
