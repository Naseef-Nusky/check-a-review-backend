/**
 * Strengthen homepage brand SEO for "check a review" searches.
 *   node scripts/update-brand-seo.js
 */
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { pool, query } from '../src/db/pool.js'
import { ensureSiteSeoColumns } from '../src/utils/seoMeta.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const BRAND = {
  seo_title: 'Check A Review | checkareview.com — Trusted customer reviews',
  seo_description:
    'Check A Review (checkareview.com) — read verified customer reviews, compare business ratings, and find companies you can trust. Search company reviews and business reviews.',
  seo_keywords:
    'check a review, checkareview, check a review website, CheckAReview, customer reviews, company reviews, business reviews, check reviews',
}

await ensureSiteSeoColumns()

const result = await query(
  `UPDATE website_settings
   SET
     seo_title = $1,
     seo_description = $2,
     seo_keywords = $3,
     updated_at = NOW()
   WHERE id IN (SELECT id FROM website_settings ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1)
   RETURNING site_name, seo_title, seo_description, seo_keywords`,
  [BRAND.seo_title, BRAND.seo_description, BRAND.seo_keywords],
)

console.log('Updated homepage brand SEO:')
console.log(JSON.stringify(result.rows[0] || null, null, 2))
await pool.end()
