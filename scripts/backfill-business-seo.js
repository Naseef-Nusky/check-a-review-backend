/**
 * Backfill missing business SEO fields:
 *   seo_title, seo_description, seo_keywords
 *
 * Usage:
 *   node scripts/backfill-business-seo.js [--dry-run] [--force]
 */
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { pool, query } from '../src/db/pool.js'
import { ensureBusinessSeoColumns } from '../src/utils/seoMeta.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

function cleanName(name) {
  return String(name || '')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSeoTitle(business) {
  const name = cleanName(business.name)
  if (!name) return null
  return `${name} Reviews | Check A Review`.slice(0, 255)
}

function buildSeoDescription(business) {
  const name = cleanName(business.name)
  if (!name) return null
  const parts = [
    `Review your experience with ${name} on Check A Review.`,
    business.category ? `Listed in ${business.category}.` : null,
    'Read verified customer reviews, ratings, and feedback.',
  ]
  return parts.filter(Boolean).join(' ').slice(0, 320)
}

function buildSeoKeywords(business) {
  const name = cleanName(business.name)
  if (!name) return null
  const bits = [
    `${name} reviews`,
    `${name} review`,
    name,
    business.category ? `${business.category} reviews` : null,
    'check a review',
    'checkareview',
  ]
  return [...new Set(bits.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))].join(', ').slice(0, 500)
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')

  console.log(dryRun ? 'DRY RUN — no writes' : 'LIVE — updating missing SEO fields')
  console.log(`Force overwrite: ${force}`)

  await ensureBusinessSeoColumns()

  const result = await query(
    `SELECT id, name, slug, category, seo_title, seo_description, seo_keywords
     FROM businesses
     ORDER BY name ASC`,
  )

  let updated = 0
  let skipped = 0
  let titleFilled = 0
  let descFilled = 0
  let kwFilled = 0

  for (const business of result.rows) {
    const nextTitle = force || !String(business.seo_title || '').trim()
      ? buildSeoTitle(business)
      : business.seo_title
    const nextDesc = force || !String(business.seo_description || '').trim()
      ? buildSeoDescription(business)
      : business.seo_description
    const nextKw = force || !String(business.seo_keywords || '').trim()
      ? buildSeoKeywords(business)
      : business.seo_keywords

    const changed =
      nextTitle !== (business.seo_title || null) ||
      nextDesc !== (business.seo_description || null) ||
      nextKw !== (business.seo_keywords || null)

    if (!changed) {
      skipped += 1
      continue
    }

    if (!String(business.seo_title || '').trim() || force) titleFilled += 1
    if (!String(business.seo_description || '').trim() || force) descFilled += 1
    if (!String(business.seo_keywords || '').trim() || force) kwFilled += 1

    if (dryRun) {
      updated += 1
      continue
    }

    await query(
      `UPDATE businesses SET
        seo_title = $1,
        seo_description = $2,
        seo_keywords = $3,
        updated_at = NOW()
       WHERE id = $4`,
      [nextTitle || null, nextDesc || null, nextKw || null, business.id],
    )
    updated += 1
  }

  console.log(
    JSON.stringify(
      {
        totalBusinesses: result.rows.length,
        updated,
        skipped,
        titleFilled,
        descriptionFilled: descFilled,
        keywordsFilled: kwFilled,
      },
      null,
      2,
    ),
  )

  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  try {
    await pool.end()
  } catch {
    // ignore
  }
  process.exit(1)
})
