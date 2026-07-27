import { query } from '../db/pool.js'

const defaultPricingContent = {
  heroTitle: 'Turn trust into growth with Check A Review',
  heroSubtitle:
    'Launch faster with plans built for growing brands, established teams, and enterprise businesses that need more visibility from reviews.',
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
      description: 'For businesses starting to collect and manage reviews consistently.',
      badge: '',
      ctaLabel: 'Start free trial',
      highlighted: false,
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
      description: 'For teams ready to accelerate conversions and automate review collection.',
      badge: 'Popular',
      ctaLabel: 'Start free trial',
      highlighted: true,
      features: [
        'Everything in Starter',
        '1,000 review invitations per month',
        'Review widgets',
        'SEO and AI discovery tools',
        'Social sharing assets',
      ],
    },
    {
      key: 'premium',
      name: 'Premium',
      price: '$199',
      period: '/month',
      description: 'For fast-growing businesses that need deeper insight and more flexibility.',
      badge: '',
      ctaLabel: 'Start free trial',
      highlighted: false,
      features: [
        'Everything in Plus',
        '5,000 review invitations per month',
        'Advanced analytics',
        'Review tagging',
        'Priority support',
      ],
    },
    {
      key: 'enterprise',
      name: 'Enterprise',
      price: 'Custom',
      period: '',
      description: 'For large organizations with multiple locations, brands, or advanced compliance needs.',
      badge: '',
      ctaLabel: 'Talk to sales',
      highlighted: false,
      features: [
        'Unlimited scale',
        'Multi-location management',
        'Enterprise onboarding',
        'Custom reporting',
        'Dedicated success support',
      ],
    },
  ],
  comparisonSections: [
    {
      title: 'Collect reviews',
      rows: [
        {
          label: 'Monthly review invitations',
          values: { starter: '100', plus: '1,000', premium: '5,000', enterprise: 'Custom' },
        },
        {
          label: 'Service reviews',
          values: { starter: true, plus: true, premium: true, enterprise: true },
        },
        {
          label: 'Product reviews',
          values: { starter: false, plus: true, premium: true, enterprise: true },
        },
        {
          label: 'Location reviews',
          values: { starter: false, plus: false, premium: true, enterprise: true },
        },
      ],
    },
    {
      title: 'Engage with feedback',
      rows: [
        {
          label: 'Public business profile',
          values: { starter: true, plus: true, premium: true, enterprise: true },
        },
        {
          label: 'Reply to reviews',
          values: { starter: true, plus: true, premium: true, enterprise: true },
        },
        {
          label: 'Review tagging',
          values: { starter: false, plus: false, premium: true, enterprise: true },
        },
      ],
    },
    {
      title: 'Accelerate conversions',
      rows: [
        {
          label: 'Trust widgets',
          values: { starter: false, plus: true, premium: true, enterprise: true },
        },
        {
          label: 'SEO & AI discovery support',
          values: { starter: false, plus: true, premium: true, enterprise: true },
        },
        {
          label: 'Marketing assets',
          values: { starter: false, plus: true, premium: true, enterprise: true },
        },
      ],
    },
    {
      title: 'Improve with insights',
      rows: [
        {
          label: 'Basic analytics',
          values: { starter: true, plus: true, premium: true, enterprise: true },
        },
        {
          label: 'Advanced analytics',
          values: { starter: false, plus: false, premium: true, enterprise: true },
        },
        {
          label: 'Market insights',
          values: { starter: false, plus: false, premium: true, enterprise: true },
        },
        {
          label: 'Custom exports',
          values: { starter: false, plus: false, premium: false, enterprise: true },
        },
      ],
    },
  ],
  faqs: [
    {
      question: 'Can I change my plan later?',
      answer: 'Yes. You can upgrade as your business grows, and we can help with enterprise migrations when needed.',
    },
    {
      question: 'Do paid plans include a free trial?',
      answer: 'Yes. The pricing page can promote a free-trial period before billing begins on eligible paid plans.',
    },
    {
      question: 'Can I manage multiple locations?',
      answer: 'Yes. Premium and Enterprise are designed to better support multi-location and multi-team workflows.',
    },
    {
      question: 'How do I contact sales?',
      answer: 'Use the Create free account or Talk to sales call to action and your team can follow up from the CRM flow.',
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
    return mapRow(result.rows[0])
  },

  async updateBusinessPricingContent(data) {
    await ensurePricingContentTable()

    const existing = await query('SELECT id FROM business_pricing_content ORDER BY updated_at DESC LIMIT 1')
    if (existing.rows.length === 0) {
      await seedDefaultPricingContent()
      return this.updateBusinessPricingContent(data)
    }

    const payload = toDbPayload(data)
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

    return mapRow(result.rows[0])
  },
}

export { defaultPricingContent }
