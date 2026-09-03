/**
 * Sync business categories into CRM (main/sub categories).
 *
 * - Seeds default CRM categories if missing
 * - Imports WordPress listing-category terms (optional SQL path)
 * - For every business.category value: ensure it exists as a CRM subcategory
 * - Normalize business.category to the exact CRM subcategory name
 *
 * Usage:
 *   node scripts/sync-business-categories.js
 *   node scripts/sync-business-categories.js "c:\\Users\\User\\Downloads\\database.sql"
 */
import fs from 'fs'
import readline from 'readline'
import pg from 'pg'
import dotenv from 'dotenv'
import { slugify } from '../src/utils/helpers.js'
import { CATEGORY_SEED } from '../src/data/categorySeedData.js'
import { parseInsertLine } from '../src/db/wpSqlParser.js'

dotenv.config()

const IMPORTED_MAIN = 'Imported Categories'
const sqlPath = process.argv[2] || ''

const useSsl =
  process.env.DATABASE_SSL === 'true' ||
  String(process.env.DATABASE_URL || '').includes('sslmode=require')

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 90000,
  idleTimeoutMillis: 30000,
})

async function query(text, params) {
  return pool.query(text, params)
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

async function uniqueSlug(base, excludeId = null) {
  let candidate = base || 'category'
  let n = 2
  while (true) {
    const existing = await query(
      excludeId
        ? `SELECT id FROM sub_categories WHERE slug = $1 AND id <> $2
           UNION ALL
           SELECT id FROM main_categories WHERE slug = $1 AND id <> $2`
        : `SELECT id FROM sub_categories WHERE slug = $1
           UNION ALL
           SELECT id FROM main_categories WHERE slug = $1`,
      excludeId ? [candidate, excludeId] : [candidate],
    )
    if (existing.rows.length === 0) return candidate
    candidate = `${base}-${n}`
    n += 1
  }
}

async function ensureMain(name) {
  const trimmed = decodeEntities(name)
  if (!trimmed) throw new Error('Main category name required')
  const existing = await query(
    `SELECT id, name FROM main_categories WHERE LOWER(name) = LOWER($1)`,
    [trimmed],
  )
  if (existing.rows[0]) return existing.rows[0]

  const sortOrderResult = await query(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM main_categories',
  )
  const slug = await uniqueSlug(slugify(trimmed))
  const inserted = await query(
    `INSERT INTO main_categories (name, slug, sort_order)
     VALUES ($1, $2, $3)
     RETURNING id, name`,
    [trimmed, slug, sortOrderResult.rows[0].next],
  )
  return inserted.rows[0]
}

async function ensureSub(mainId, name) {
  const trimmed = decodeEntities(name)
  if (!trimmed) throw new Error('Subcategory name required')
  const existing = await query(
    `SELECT id, name, main_category_id
     FROM sub_categories
     WHERE LOWER(name) = LOWER($1)`,
    [trimmed],
  )
  if (existing.rows[0]) return existing.rows[0]

  const slug = await uniqueSlug(slugify(trimmed))
  const inserted = await query(
    `INSERT INTO sub_categories (main_category_id, name, slug)
     VALUES ($1, $2, $3)
     RETURNING id, name, main_category_id`,
    [mainId, trimmed, slug],
  )
  return inserted.rows[0]
}

async function loadWpCategories(path) {
  if (!path || !fs.existsSync(path)) return []

  const terms = new Map()
  const taxonomies = new Map()
  const rl = readline.createInterface({
    input: fs.createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    const termRow = parseInsertLine(line, 'SERVMASK_PREFIX_terms')
    if (termRow) {
      terms.set(Number(termRow[0]), decodeEntities(termRow[1]))
      continue
    }
    const taxRow = parseInsertLine(line, 'SERVMASK_PREFIX_term_taxonomy')
    if (taxRow) {
      taxonomies.set(Number(taxRow[0]), {
        termId: Number(taxRow[1]),
        taxonomy: String(taxRow[2] || ''),
        parent: Number(taxRow[4] || 0),
      })
    }
  }

  const list = []
  for (const [taxId, tax] of taxonomies) {
    if (tax.taxonomy !== 'listing-category') continue
    const name = terms.get(tax.termId)
    if (!name) continue
    let parentName = null
    if (tax.parent) {
      const parentTax = taxonomies.get(tax.parent)
      if (parentTax) parentName = terms.get(parentTax.termId) || null
    }
    list.push({ name, parentName, taxId })
  }
  return list
}

async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS main_categories (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(150) UNIQUE NOT NULL,
      slug VARCHAR(180) UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await query(`
    CREATE TABLE IF NOT EXISTS sub_categories (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      main_category_id UUID NOT NULL REFERENCES main_categories(id) ON DELETE CASCADE,
      name VARCHAR(150) NOT NULL,
      slug VARCHAR(180) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (main_category_id, name),
      UNIQUE (slug)
    )
  `)
}

async function seedDefaults() {
  let mainsCreated = 0
  let subsCreated = 0
  for (let i = 0; i < CATEGORY_SEED.length; i += 1) {
    const item = CATEGORY_SEED[i]
    const slug = slugify(item.name)
    let mainId
    const existingMain = await query(
      'SELECT id FROM main_categories WHERE LOWER(name) = LOWER($1) OR slug = $2',
      [item.name, slug],
    )
    if (existingMain.rows.length > 0) {
      mainId = existingMain.rows[0].id
    } else {
      const inserted = await query(
        `INSERT INTO main_categories (name, slug, sort_order)
         VALUES ($1, $2, $3) RETURNING id`,
        [item.name, slug, i + 1],
      )
      mainId = inserted.rows[0].id
      mainsCreated += 1
    }
    for (const subName of item.subcategories) {
      const subSlug = slugify(subName)
      const existingSub = await query(
        `SELECT id FROM sub_categories
         WHERE main_category_id = $1 AND LOWER(name) = LOWER($2)`,
        [mainId, subName],
      )
      if (existingSub.rows.length > 0) continue
      const slugTaken = await query('SELECT id FROM sub_categories WHERE slug = $1', [subSlug])
      const finalSlug = slugTaken.rows.length > 0 ? await uniqueSlug(subSlug) : subSlug
      await query(
        `INSERT INTO sub_categories (main_category_id, name, slug)
         VALUES ($1, $2, $3)`,
        [mainId, subName, finalSlug],
      )
      subsCreated += 1
    }
  }
  return { mainsCreated, subsCreated }
}

async function main() {
  console.log('Connecting to database…')
  await ensureTables()

  console.log('Seeding default CRM categories (if missing)…')
  const seedResult = await seedDefaults()
  console.log('Seed result:', seedResult)

  const importedMain = await ensureMain(IMPORTED_MAIN)
  let wpAdded = 0
  let wpSkipped = 0

  if (sqlPath) {
    console.log('Importing WordPress listing categories from:', sqlPath)
    const wpCats = await loadWpCategories(sqlPath)
    console.log('WP listing categories found:', wpCats.length)

    for (const item of wpCats) {
      if (item.parentName) {
        const parent = await ensureMain(item.parentName)
        const before = await query(
          `SELECT id FROM sub_categories WHERE LOWER(name) = LOWER($1)`,
          [item.name],
        )
        await ensureSub(parent.id, item.name)
        if (before.rows.length === 0) wpAdded += 1
        else wpSkipped += 1
      } else {
        // Flat WP term: if already a CRM sub/main, skip creating duplicate sub under Imported
        const asSub = await query(
          `SELECT id FROM sub_categories WHERE LOWER(name) = LOWER($1)`,
          [item.name],
        )
        if (asSub.rows[0]) {
          wpSkipped += 1
          continue
        }
        const asMain = await query(
          `SELECT id FROM main_categories WHERE LOWER(name) = LOWER($1)`,
          [item.name],
        )
        if (asMain.rows[0]) {
          // Use main as parent and create a matching general leaf for assignments
          await ensureSub(asMain.rows[0].id, item.name)
          wpAdded += 1
          continue
        }
        await ensureSub(importedMain.id, item.name)
        wpAdded += 1
      }
    }
    console.log(`WP categories → added ${wpAdded}, already present ${wpSkipped}`)
  }

  const businessCats = await query(`
    SELECT DISTINCT TRIM(category) AS category
    FROM businesses
    WHERE category IS NOT NULL AND TRIM(category) <> ''
    ORDER BY 1
  `)

  console.log('Unique business categories:', businessCats.rows.length)

  let createdSubs = 0
  let normalized = 0
  let alreadyOk = 0
  let unmatchedLeft = 0

  for (const row of businessCats.rows) {
    const stored = String(row.category || '').trim()
    const raw = decodeEntities(stored)
    if (!raw) continue

    // Prefer existing subcategory (any main)
    let sub = (
      await query(
        `SELECT id, name, main_category_id
         FROM sub_categories
         WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [raw],
      )
    ).rows[0]

    if (!sub) {
      // If it matches a main category name, create leaf under that main
      const mainMatch = (
        await query(
          `SELECT id, name FROM main_categories WHERE LOWER(name) = LOWER($1) LIMIT 1`,
          [raw],
        )
      ).rows[0]

      if (mainMatch) {
        sub = await ensureSub(mainMatch.id, raw)
        createdSubs += 1
      } else {
        sub = await ensureSub(importedMain.id, raw)
        createdSubs += 1
      }
    }

    // Normalize all businesses using this category string (raw or HTML-encoded) to exact CRM name
    const updated = await query(
      `UPDATE businesses
       SET category = $1, updated_at = NOW()
       WHERE category IS DISTINCT FROM $1
         AND (
           LOWER(TRIM(category)) = LOWER($2)
           OR LOWER(TRIM(category)) = LOWER($3)
           OR REPLACE(LOWER(TRIM(category)), '&amp;', '&') = LOWER($2)
         )`,
      [sub.name, raw, stored],
    )
    if (updated.rowCount > 0) normalized += updated.rowCount
    else alreadyOk += 1
  }

  // Final check: businesses still not matching any subcategory
  const orphans = await query(`
    SELECT b.category, COUNT(*)::int AS count
    FROM businesses b
    LEFT JOIN sub_categories s
      ON LOWER(s.name) = LOWER(TRIM(b.category))
      OR LOWER(s.name) = LOWER(REPLACE(TRIM(b.category), '&amp;', '&'))
    WHERE b.category IS NOT NULL AND TRIM(b.category) <> '' AND s.id IS NULL
    GROUP BY b.category
    ORDER BY count DESC
  `)
  unmatchedLeft = orphans.rows.length

  const totals = await query(`
    SELECT
      (SELECT COUNT(*)::int FROM main_categories) AS mains,
      (SELECT COUNT(*)::int FROM sub_categories) AS subs,
      (SELECT COUNT(*)::int FROM businesses) AS businesses
  `)

  console.log('\nDone')
  console.log('CRM totals:', totals.rows[0])
  console.log('New subcategories created from businesses:', createdSubs)
  console.log('Businesses normalized to CRM names:', normalized)
  console.log('Business categories already matching:', alreadyOk)
  console.log('Orphan categories remaining:', unmatchedLeft)
  if (orphans.rows.length) {
    console.log(orphans.rows)
  }
}

main()
  .then(async () => {
    await pool.end()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error('Sync failed:', err.message || err)
    try {
      await pool.end()
    } catch {
      // ignore
    }
    process.exit(1)
  })
