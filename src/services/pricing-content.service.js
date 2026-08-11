import { query } from '../db/pool.js'

const defaultPricingContent = {
  heroTitle: 'Turn trust into growth with Check A Review',
  heroSubtitle:
    'Launch faster with plans built for growing brands and established teams that need more visibility from reviews.',
  billingNote: 'Choose the plan that fits your business today and scale up when you need more review reach, insight, and conversion tools.',
  trustBadge: '14-day free trial on paid plans',
  logos: ['ADT', 'Marriott', 'HubSpot', 'Pipedrive', 'Zendesk', 'Shopify'],
  steps: [
    {
      title: 'Pick your plan',
      description: 'Start with a plan that matches your current review volume and growth stage.',
    },
    {
      title: 'Collect more reviews',
      description: 'Send branded invitations and automate follow-ups to gather trusted customer feedback.',
    },
    {
      title: 'Convert that trust',
      description: 'Show ratings, improve visibility, and turn social proof into more sales.',
    },
    {
      title: 'Learn and improve',
      description: 'Use analytics and insight tools to understand customer sentiment and grow revenue.',
    },
  ],
  plans: [
    {
      key: 'starter',
      name: 'Starter',
      price: '$29',
      period: '/month',
      description: 'One website — ideal for a small business getting started with reviews.',
      badge: '',
      ctaLabel: 'Start free trial',
      highlighted: false,
      users: '1',
      domains: '1',
      features: [
        'Business profile page',
        '100 review invitations per month',
        'Reply to public reviews',
        'Basic reporting dashboard',
      ],
    },
    {
      key: 'plus',
      name: 'Plus',
      price: '$99',
      period: '/month',
      description: 'Up to 3 websites — for businesses with multiple country sites.',
      badge: 'Popular',
      ctaLabel: 'Start free trial',
      highlighted: true,
      users: '3',
      domains: '3',
      features: [
        'Everything in Starter',
        '1,000 review invitations per month',
        'Review widgets',
        'SEO and AI discovery tools',
        'Social sharing assets',
        'AI summary',
      ],
    },
    {
      key: 'premium',
      name: 'Premium',
      price: '$199',
      period: '/month',
      description: 'Unlimited domains — for large companies or agencies.',
      badge: '',
      ctaLabel: 'Start free trial',
      highlighted: false,
      users: 'Unlimited',
      domains: 'Unlimited',
      features: [
        'Everything in Plus',
        '5,000 review invitations per month',
        'Advanced analytics',
        'Review tagging',
        'AI summary',
        'Priority support',
      ],
    },
  ],
  comparisonSections: [
    {
      title: 'Collect reviews',
      rows: [
        {
          label: 'Users',
          values: { starter: '1', plus: '3', premium: 'Unlimited' },
        },
        {
          label: 'Domains',
          values: { starter: '1', plus: '3', premium: 'Unlimited' },
        },
        {
          label: 'Monthly review invitations',
          values: { starter: '100', plus: '1,000', premium: '5,000' },
        },
        {
          label: 'Service reviews',
          values: { starter: true, plus: true, premium: true },
        },
        {
          label: 'Product reviews',
          values: { starter: false, plus: true, premium: true },
        },
        {
          label: 'Location reviews',
          values: { starter: false, plus: false, premium: true },
        },
      ],
    },
    {
      title: 'Engage with feedback',
      rows: [
        {
          label: 'Public business profile',
          values: { starter: true, plus: true, premium: true },
        },
        {
          label: 'Reply to reviews',
          values: { starter: true, plus: true, premium: true },
        },
        {
          label: 'Review tagging',
          values: { starter: false, plus: false, premium: true },
        },
      ],
    },
    {
      title: 'Accelerate conversions',
      rows: [
        {
          label: 'Trust widgets',
          values: { starter: false, plus: true, premium: true },
        },
        {
          label: 'SEO & AI discovery support',
          values: { starter: false, plus: true, premium: true },
        },
        {
          label: 'Marketing assets',
          values: { starter: false, plus: true, premium: true },
        },
      ],
    },
    {
      title: 'Improve with insights',
      rows: [
        {
          label: 'Basic analytics',
          values: { starter: true, plus: true, premium: true },
        },
        {
          label: 'Advanced analytics',
          values: { starter: false, plus: false, premium: true },
        },
        {
          label: 'Market insights',
          values: { starter: false, plus: false, premium: true },
        },
        {
          label: 'AI summary',
          values: { starter: false, plus: true, premium: true },
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'Can I change my plan later?',
      answer: 'Yes. You can upgrade as your business grows whenever you need more reviews, insights, or conversion tools.',
    },
    {
      question: 'Do paid plans include a free trial?',
      answer: 'Yes. The pricing page can promote a free-trial period before billing begins on eligible paid plans.',
    },
    {
      question: 'Can I manage multiple locations?',
      answer: 'Yes. Premium is designed to better support multi-location and multi-team workflows.',
    },
  ],
}

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
    updatedAt: row.updated_at,
  }
}

const AI_SUMMARY_FEATURE = {
  label: 'AI summary',
  values: { starter: false, plus: true, premium: true },
}

const DEFAULT_PLAN_LIMITS = {
  starter: { users: '1', domains: '1' },
  plus: { users: '3', domains: '3' },
  premium: { users: 'Unlimited', domains: 'Unlimited' },
}

const LIMIT_FEATURES = [
  { label: 'Users', field: 'users' },
  { label: 'Domains', field: 'domains' },
]

function isEnterprisePlan(plan) {
  return String(plan?.key || plan?.name || '')
    .trim()
    .toLowerCase() === 'enterprise'
}

function stripEnterpriseFromContent(content = {}) {
  const plans = (Array.isArray(content.plans) ? content.plans : []).filter((plan) => !isEnterprisePlan(plan))
  const comparisonSections = (Array.isArray(content.comparisonSections) ? content.comparisonSections : []).map(
    (section) => ({
      ...section,
      rows: (Array.isArray(section?.rows) ? section.rows : [])
        .map((row) => {
          const values = { ...(row?.values || {}) }
          delete values.enterprise
          return { ...row, values }
        })
        .filter((row) => {
          const values = Object.values(row.values || {})
          return values.some((value) => {
            if (value === true) return true
            if (typeof value === 'string') {
              const normalized = value.trim().toLowerCase()
              return normalized && !['false', 'no', '0', '—', '-'].includes(normalized)
            }
            return false
          })
        }),
    }),
  )

  return { ...content, plans, comparisonSections }
}

function findComparisonValue(sections, planKey, label) {
  const match = String(label).toLowerCase()
  for (const section of Array.isArray(sections) ? sections : []) {
    for (const row of Array.isArray(section?.rows) ? section.rows : []) {
      if (String(row?.label || '').trim().toLowerCase() === match) {
        return row?.values?.[planKey]
      }
    }
  }
  return undefined
}

function limitText(value, fallback) {
  if (typeof value === 'boolean') return fallback
  const text = String(value ?? '').trim()
  if (!text || ['true', 'false', 'yes', 'no', '✓', '—', '-'].includes(text.toLowerCase())) {
    return fallback
  }
  return text
}

function ensurePlanLimits(content = {}) {
  const plans = (Array.isArray(content.plans) ? content.plans : []).map((plan) => {
    const defaults = DEFAULT_PLAN_LIMITS[plan.key] || { users: '1', domains: '1' }
    return {
      ...plan,
      users: limitText(
        plan.users || findComparisonValue(content.comparisonSections, plan.key, 'Users'),
        defaults.users,
      ),
      domains: limitText(
        plan.domains || findComparisonValue(content.comparisonSections, plan.key, 'Domains'),
        defaults.domains,
      ),
    }
  })

  let sections = Array.isArray(content.comparisonSections) ? [...content.comparisonSections] : []
  if (sections.length === 0) {
    sections = [{ title: 'Features', rows: [] }]
  }

  const firstSection = { ...sections[0], rows: [...(sections[0].rows || [])] }

  for (const { label, field } of [...LIMIT_FEATURES].reverse()) {
    const values = plans.reduce((acc, plan) => {
      if (!plan.key) return acc
      acc[plan.key] = String(plan[field] || DEFAULT_PLAN_LIMITS[plan.key]?.[field] || '1')
      return acc
    }, {})
    const index = firstSection.rows.findIndex(
      (row) => String(row?.label || '').trim().toLowerCase() === label.toLowerCase(),
    )
    if (index >= 0) {
      firstSection.rows[index] = {
        label,
        values: { ...firstSection.rows[index].values, ...values },
      }
    } else {
      firstSection.rows = [{ label, values }, ...firstSection.rows]
    }
  }

  sections[0] = firstSection
  return { ...content, plans, comparisonSections: sections }
}

function ensureAiSummaryFeature(content) {
  const sections = Array.isArray(content.comparisonSections) ? [...content.comparisonSections] : []
  const labelMatch = (label) => String(label || '').trim().toLowerCase() === 'ai summary'

  const alreadyPresent = sections.some((section) =>
    (Array.isArray(section?.rows) ? section.rows : []).some((row) => labelMatch(row?.label)),
  )
  if (alreadyPresent) return content

  if (sections.length === 0) {
    return {
      ...content,
      comparisonSections: [{ title: 'Features', rows: [{ ...AI_SUMMARY_FEATURE, values: { ...AI_SUMMARY_FEATURE.values } }] }],
    }
  }

  const lastIndex = sections.length - 1
  const lastSection = sections[lastIndex]
  sections[lastIndex] = {
    ...lastSection,
    rows: [
      ...(Array.isArray(lastSection?.rows) ? lastSection.rows : []),
      { ...AI_SUMMARY_FEATURE, values: { ...AI_SUMMARY_FEATURE.values } },
    ],
  }

  return { ...content, comparisonSections: sections }
}

function normalizePricingContent(content) {
  return ensurePlanLimits(ensureAiSummaryFeature(stripEnterpriseFromContent(content)))
}

async function seedDefaultPricingContent() {
  const payload = toDbPayload(defaultPricingContent)
  const result = await query(
    `INSERT INTO business_pricing_content
      (hero_title, hero_subtitle, billing_note, trust_badge, logos, steps, plans, comparison_sections, faqs)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)
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
    ],
  )

  return mapRow(result.rows[0])
}

export const pricingContentService = {
  async getBusinessPricingContent() {
    await ensurePricingContentTable()
    const result = await query('SELECT * FROM business_pricing_content ORDER BY updated_at DESC LIMIT 1')
    if (result.rows.length === 0) {
      return seedDefaultPricingContent()
    }
    return normalizePricingContent(mapRow(result.rows[0]))
  },

  async updateBusinessPricingContent(data) {
    await ensurePricingContentTable()

    const existing = await query('SELECT id FROM business_pricing_content ORDER BY updated_at DESC LIMIT 1')
    if (existing.rows.length === 0) {
      await seedDefaultPricingContent()
      return this.updateBusinessPricingContent(data)
    }

    const payload = toDbPayload(normalizePricingContent(data))
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
           updated_at = NOW()
       WHERE id = $10
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
        existing.rows[0].id,
      ],
    )

    return normalizePricingContent(mapRow(result.rows[0]))
  },
}

export { defaultPricingContent }
