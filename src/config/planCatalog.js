export const CATALOG_VERSION = 11
export const UNLIMITED = Number.POSITIVE_INFINITY

export const ASSIGNABLE_PLANS = ['free', 'starter', 'plus', 'premium']
export const PAID_SQUARE_PLANS = ['starter', 'plus', 'premium']
export const MARKETING_PLAN_ORDER = ['starter', 'plus', 'premium']

export function isUnlimited(value) {
  return !Number.isFinite(Number(value))
}

export function formatLimit(value) {
  return isUnlimited(value) ? 'Unlimited' : String(value)
}

export function monthlyCents(monthlyDollars) {
  return Math.round(Number(monthlyDollars || 0) * 100)
}

function plan({
  key,
  name,
  tagline,
  monthlyDollars,
  perDomain = false,
  checkout = 'buy',
  trialDays = 0,
  invitationsPerMonth,
  widgets,
  users,
  domains,
  integrations,
  marketingAssets = true,
  brandMatch = false,
  dedicatedCsm = false,
  advancedAnalytics = false,
  optimizedInvites = false,
  canReplyToReviews = false,
  highlighted = false,
  badge = '',
  ctaLabel,
  notes = [],
  description,
  features,
}) {
  const amount = monthlyCents(monthlyDollars)
  return {
    key,
    name,
    tagline,
    description,
    monthlyDollars,
    monthlyAmountCents: amount,
    amountCents: amount,
    cadence: 'MONTHLY',
    perDomain,
    checkout,
    trialDays,
    invitationsPerMonth,
    widgets,
    users,
    domains,
    integrations,
    marketingAssets,
    brandMatch,
    dedicatedCsm,
    advancedAnalytics,
    optimizedInvites,
    canReplyToReviews,
    highlighted,
    badge,
    ctaLabel,
    notes,
    features,
    priceLabel: monthlyDollars > 0 ? `£${monthlyDollars}` : 'Custom',
    periodLabel: monthlyDollars > 0
      ? perDomain
        ? '/month, per domain'
        : '/month'
      : '',
  }
}

export const PLAN_CATALOG = {
  free: plan({
    key: 'free',
    name: 'Free',
    tagline: 'Claim your profile',
    monthlyDollars: 0,
    checkout: 'free',
    invitationsPerMonth: 10,
    widgets: 0,
    users: 1,
    domains: 1,
    integrations: 0,
    marketingAssets: false,
    ctaLabel: 'Current plan',
    description: 'Default plan after signup. Upgrade to Starter to reply to reviews, send more invitations, and embed widgets.',
    features: [
      'Public business profile (after approval)',
      'Read customer reviews',
      '10 review invitations per month',
      '1 user',
      '1 domain',
    ],
  }),
  starter: plan({
    key: 'starter',
    name: 'Starter',
    tagline: 'Start growing trust',
    monthlyDollars: 99,
    checkout: 'buy',
    canReplyToReviews: true,
    invitationsPerMonth: 100,
    widgets: 2,
    users: 1,
    domains: 1,
    integrations: 15,
    ctaLabel: 'Buy now',
    notes: [
      'Designed for small businesses (up to $5M revenue).',
      'Available to new customers only.',
    ],
    description: 'One website — for small businesses getting started with reviews.',
    features: [
      'Public replies to customer reviews',
      '100 review invitations per month',
      '2 widgets to collect reviews and showcase trust',
      '1 user',
      '1 domain',
      'Power your ads with Check A Review marketing assets',
    ],
  }),
  plus: plan({
    key: 'plus',
    name: 'Plus',
    tagline: 'Turn trust into demand',
    monthlyDollars: 319,
    checkout: 'trial',
    trialDays: 14,
    canReplyToReviews: true,
    invitationsPerMonth: 300,
    widgets: 10,
    users: 3,
    domains: 3,
    integrations: UNLIMITED,
    brandMatch: true,
    highlighted: true,
    badge: 'Popular',
    ctaLabel: 'Try free for 14 days',
    description: 'Up to 3 websites — for businesses growing review volume across domains.',
    features: [
      '300 review invitations per month',
      '10 widgets to collect reviews and showcase TrustScore',
      '3 users',
      'Up to 3 domains',
      'Power your ads with Check A Review marketing assets',
      'Match your public profile to your brand',
    ],
  }),
  premium: plan({
    key: 'premium',
    name: 'Premium',
    tagline: 'Make feedback your competitive edge',
    monthlyDollars: 799,
    checkout: 'demo',
    canReplyToReviews: true,
    invitationsPerMonth: 1000,
    widgets: 21,
    users: 10,
    domains: UNLIMITED,
    integrations: UNLIMITED,
    brandMatch: true,
    dedicatedCsm: true,
    advancedAnalytics: true,
    ctaLabel: 'Book demo',
    description: 'Unlimited domains — for larger teams that need richer data and support.',
    features: [
      '1,000 review invitations per month',
      '21 widgets to showcase TrustScore and testimonials',
      '10 users',
      'Unlimited domains',
      'Power your ads with Check A Review marketing assets',
      'Match your public profile to your brand',
      'Dedicated Customer Success Manager',
      'More dashboards with richer data, insights, and trends',
    ],
  }),
}

export const WIDGET_CATALOG = [
  { id: 'trust-badge', name: 'TrustScore badge', description: 'Compact score mark for headers and ads.', layout: 'compact', height: 140 },
  { id: 'mini-stars', name: 'Mini ratings bar', description: 'Star rating strip for product pages.', layout: 'compact', height: 140 },
  { id: 'classic', name: 'Classic reviews', description: 'Business summary and recent reviews.', layout: 'classic', height: 360 },
  { id: 'compact', name: 'Compact header', description: 'Short rating bar for headers and footers.', layout: 'compact', height: 140 },
  { id: 'dark', name: 'Dark testimonial', description: 'Full review card for dark website sections.', layout: 'dark', height: 360 },
  { id: 'product-stars', name: 'Product page stars', description: 'Inline stars for product detail pages.', layout: 'compact', height: 140 },
  { id: 'sidebar', name: 'Sidebar reviews', description: 'Vertical review list for blog or account pages.', layout: 'classic', height: 420 },
  { id: 'marquee', name: 'Horizontal trust bar', description: 'Wide rating bar for landing pages.', layout: 'compact', height: 140 },
  { id: 'quote-cards', name: 'Quote cards', description: 'Highlighted customer quotes with TrustScore.', layout: 'classic', height: 360 },
  { id: 'trust-bar', name: 'Trust bar', description: 'Showcase TrustScore next to conversion CTAs.', layout: 'compact', height: 140 },
  { id: 'grid', name: 'Review grid', description: 'Multi-review grid for home pages.', layout: 'classic', height: 480 },
  { id: 'hero', name: 'Hero banner', description: 'Large TrustScore block for campaign pages.', layout: 'classic', height: 280 },
  { id: 'floating-badge', name: 'Floating badge', description: 'Corner badge style for persistent social proof.', layout: 'compact', height: 140 },
  { id: 'email-signature', name: 'Email signature', description: 'Slim rating mark for outbound email.', layout: 'compact', height: 120 },
  { id: 'checkout-trust', name: 'Checkout trust', description: 'Reassurance unit for cart and checkout.', layout: 'compact', height: 140 },
  { id: 'social-strip', name: 'Social proof strip', description: 'Horizontal proof strip for ads and landers.', layout: 'compact', height: 140 },
  { id: 'location-snapshot', name: 'Location snapshot', description: 'Score snapshot for location landing pages.', layout: 'classic', height: 320 },
  { id: 'detailed-list', name: 'Detailed review list', description: 'Longer recent-review list for TrustScore pages.', layout: 'classic', height: 520 },
  { id: 'quote-spotlight', name: 'Quote spotlight', description: 'Single large testimonial with score.', layout: 'classic', height: 280 },
  { id: 'premium-carousel', name: 'Premium carousel', description: 'Rich TrustScore and testimonial layout.', layout: 'classic', height: 420 },
  { id: 'insights-teaser', name: 'Insights teaser', description: 'Score plus trend-style summary for dashboards.', layout: 'classic', height: 360 },
  { id: 'enterprise-wall', name: 'Large review wall', description: 'Largest testimonial wall for brand sites.', layout: 'classic', height: 560 },
]

export const INTEGRATION_CATALOG = [
  'Shopify',
  'WooCommerce',
  'BigCommerce',
  'Magento',
  'Google Ads',
  'Meta Ads',
  'HubSpot',
  'Mailchimp',
  'Klaviyo',
  'Salesforce',
  'Zendesk',
  'Intercom',
  'Slack',
  'Zapier',
  'Make',
  'Segment',
  'GA4',
  'Pipedrive',
  'Stripe Billing',
  'Square Online',
  'WordPress',
  'Webflow',
]

export function getPlan(planKey) {
  const key = String(planKey || 'free').toLowerCase()
  return PLAN_CATALOG[key] || PLAN_CATALOG.free
}

export function allowedWidgetsForPlan(planKey) {
  const limit = getPlan(planKey).widgets
  if (isUnlimited(limit)) return WIDGET_CATALOG
  return WIDGET_CATALOG.slice(0, Math.max(0, Number(limit) || 0))
}

export function allowedIntegrationsForPlan(planKey) {
  const limit = getPlan(planKey).integrations
  if (isUnlimited(limit)) return INTEGRATION_CATALOG
  return INTEGRATION_CATALOG.slice(0, Math.max(0, Number(limit) || 0))
}

export function isWidgetAllowed(planKey, widgetId) {
  return allowedWidgetsForPlan(planKey).some((item) => item.id === widgetId)
}

export function buildPricingContentFromCatalog() {
  const plans = MARKETING_PLAN_ORDER.map((key) => {
    const plan = PLAN_CATALOG[key]
    return {
      key: plan.key,
      name: plan.name,
      price: plan.checkout === 'sales' ? 'Contact sales' : plan.priceLabel,
      period: plan.periodLabel,
      description: `${plan.tagline}. ${plan.description}`,
      badge: plan.badge,
      ctaLabel: plan.ctaLabel,
      highlighted: plan.highlighted,
      users: formatLimit(plan.users),
      domains: formatLimit(plan.domains),
      features: plan.features,
      notes: plan.notes,
    }
  })

  const value = (key, field) => {
    const plan = PLAN_CATALOG[key]
    const raw = plan[field]
    if (typeof raw === 'boolean') return raw
    if (field === 'invitationsPerMonth') return isUnlimited(raw) ? 'Unlimited' : String(raw)
    if (field === 'widgets') return String(raw)
    if (field === 'integrations') return isUnlimited(raw) ? 'All' : String(raw)
    return formatLimit(raw)
  }

  return {
    heroTitle: 'Turn trust into growth with Check A Review',
    heroSubtitle:
      'Plans built like a modern review platform: collect feedback, showcase TrustScore, and convert trust into demand.',
    billingNote:
      'Paid plans are priced and billed monthly in GBP.',
    trustBadge: '14-day free trial on Plus',
    logos: [],
    steps: [
      {
        title: 'Pick your plan',
        description: 'Start with Starter, grow into Plus, or upgrade to Premium for richer insights.',
      },
      {
        title: 'Collect more reviews',
        description: 'Send monthly invitations within your plan quota and follow up with customers.',
      },
      {
        title: 'Showcase trust',
        description: 'Embed widgets on your allowed domains and match your public profile to your brand.',
      },
      {
        title: 'Learn and improve',
        description: 'Use analytics and, on higher plans, richer dashboards plus a customer success manager.',
      },
    ],
    plans,
    comparisonSections: [
      {
        title: 'Collect reviews',
        rows: [
          { label: 'Users', values: { starter: value('starter', 'users'), plus: value('plus', 'users'), premium: value('premium', 'users') } },
          { label: 'Domains', values: { starter: value('starter', 'domains'), plus: value('plus', 'domains'), premium: value('premium', 'domains') } },
          { label: 'Monthly review invitations', values: { starter: value('starter', 'invitationsPerMonth'), plus: value('plus', 'invitationsPerMonth'), premium: value('premium', 'invitationsPerMonth') } },
          { label: 'Public replies to reviews', values: { starter: true, plus: true, premium: true } },
          { label: 'Widgets', values: { starter: value('starter', 'widgets'), plus: value('plus', 'widgets'), premium: value('premium', 'widgets') } },
        ],
      },
      {
        title: 'Convert trust',
        rows: [
          { label: 'Public business profile', values: { starter: true, plus: true, premium: true } },
          { label: 'Marketing assets', values: { starter: true, plus: true, premium: true } },
          { label: 'Match profile to your brand', values: { starter: false, plus: true, premium: true } },
        ],
      },
      {
        title: 'Insights and support',
        rows: [
          { label: 'Basic analytics', values: { starter: true, plus: true, premium: true } },
          { label: 'Richer dashboards and trends', values: { starter: false, plus: false, premium: true } },
          { label: 'Dedicated Customer Success Manager', values: { starter: false, plus: false, premium: true } },
          { label: '14-day free trial', values: { starter: false, plus: true, premium: false } },
        ],
      },
    ],
    faqs: [
      {
        question: 'Are prices billed monthly or annually?',
        answer: 'Prices are shown per month in GBP and billed monthly.',
      },
      {
        question: 'Does Plus include a free trial?',
        answer: 'Yes. Plus includes a 14-day free trial for new customers before monthly billing begins.',
      },
      {
        question: 'How do I get Premium?',
        answer: 'Choose Premium from the business portal subscription page and complete Square checkout.',
      },
      {
        question: 'Can I change plans later?',
        answer: 'Yes. Upgrade any time from the business portal. Downgrading to Free cancels the paid Square subscription.',
      },
    ],
  }
}
