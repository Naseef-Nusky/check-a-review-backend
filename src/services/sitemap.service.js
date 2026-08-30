import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { ensureBusinessStatusColumn } from './business.service.js'
import { categoryService } from './category.service.js'

const STATIC_PATHS = [
  '/',
  '/search',
  '/categories',
  '/reviews',
  '/about',
  '/trust-centre',
  '/contact',
  '/help',
  '/help/reviewers',
  '/help/businesses',
  '/review-tips',
  '/privacy',
  '/terms',
  '/terms/business',
]

function siteOrigin() {
  return String(env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/$/, '')
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

export const sitemapService = {
  async buildXml() {
    await ensureBusinessStatusColumn()
    const origin = siteOrigin()
    const today = toIsoDate(new Date())
    const entries = []

    for (const path of STATIC_PATHS) {
      entries.push(
        urlEntry({
          loc: `${origin}${path}`,
          lastmod: today,
          changefreq: path === '/' ? 'daily' : 'weekly',
          priority: path === '/' ? '1.0' : '0.7',
        }),
      )
    }

    try {
      const tree = await categoryService.getCategoryTree()
      for (const main of tree || []) {
        entries.push(
          urlEntry({
            loc: `${origin}/categories?cat=${encodeURIComponent(main.name)}`,
            lastmod: today,
            changefreq: 'weekly',
            priority: '0.6',
          }),
        )
      }
    } catch {
      // Categories are optional for sitemap generation
    }

    const businesses = await query(
      `SELECT slug, updated_at
       FROM businesses
       WHERE status = 'published' AND slug IS NOT NULL AND slug <> ''
       ORDER BY updated_at DESC`,
    )

    for (const business of businesses.rows) {
      entries.push(
        urlEntry({
          loc: `${origin}/businesses/${encodeURIComponent(business.slug)}`,
          lastmod: toIsoDate(business.updated_at),
          changefreq: 'weekly',
          priority: '0.8',
        }),
      )
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`
  },
}
