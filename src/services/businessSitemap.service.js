import { env } from '../config/env.js'

const BUSINESS_MARKETING_PATHS = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/pricing', changefreq: 'weekly', priority: '0.9' },
  { path: '/contact', changefreq: 'monthly', priority: '0.8' },
  { path: '/how-it-works', changefreq: 'monthly', priority: '0.8' },
  { path: '/setup', changefreq: 'monthly', priority: '0.8' },
  { path: '/solutions/engage-with-feedback', changefreq: 'monthly', priority: '0.7' },
  { path: '/solutions/accelerate-conversions', changefreq: 'monthly', priority: '0.7' },
  { path: '/solutions/improve-with-insights', changefreq: 'monthly', priority: '0.7' },
  { path: '/features/respond-to-reviews', changefreq: 'monthly', priority: '0.7' },
  { path: '/features/profile-page', changefreq: 'monthly', priority: '0.7' },
]

function businessSiteOrigin() {
  return String(env.BUSINESS_PORTAL_URL || 'http://localhost:5175').replace(/\/$/, '')
}

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function toIsoDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10)
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10)
  return date.toISOString().slice(0, 10)
}

function urlEntry({ loc, lastmod, changefreq = 'weekly', priority = '0.5' }) {
  return `  <url>
    <loc>${escapeXml(loc)}</loc>
    <lastmod>${escapeXml(lastmod)}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
}

export const businessSitemapService = {
  buildXml() {
    const origin = businessSiteOrigin()
    const today = toIsoDate(new Date())
    const entries = BUSINESS_MARKETING_PATHS.map(({ path, changefreq, priority }) =>
      urlEntry({
        loc: `${origin}${path}`,
        lastmod: today,
        changefreq,
        priority,
      }),
    )

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`
  },
}
