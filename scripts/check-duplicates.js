import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const { Pool } = pg
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

async function main() {
  const dupSlugs = await pool.query(`
    SELECT slug, COUNT(*)::int c,
           array_agg(id ORDER BY created_at) AS ids,
           array_agg(name ORDER BY created_at) AS names,
           array_agg(created_at ORDER BY created_at) AS created_ats
    FROM businesses
    GROUP BY slug
    HAVING COUNT(*) > 1
    ORDER BY c DESC
    LIMIT 20
  `)

  const dupNames = await pool.query(`
    SELECT LOWER(TRIM(name)) AS n, COUNT(*)::int AS c
    FROM businesses
    GROUP BY LOWER(TRIM(name))
    HAVING COUNT(*) > 1
    ORDER BY c DESC
    LIMIT 10
  `)

  const dupReviews = await pool.query(`
    SELECT business_id, user_id, title, rating, LEFT(content, 80) AS content_prefix, COUNT(*)::int AS c
    FROM reviews
    GROUP BY business_id, user_id, title, rating, LEFT(content, 80)
    HAVING COUNT(*) > 1
    ORDER BY c DESC
    LIMIT 20
  `)

  const reviewDupByBizUser = await pool.query(`
    SELECT business_id, user_id, COUNT(*)::int AS c
    FROM reviews
    GROUP BY business_id, user_id
    HAVING COUNT(*) > 1
    ORDER BY c DESC
    LIMIT 20
  `)

  const totals = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM businesses) AS businesses,
      (SELECT COUNT(DISTINCT slug)::int FROM businesses) AS unique_slugs,
      (SELECT COUNT(*)::int FROM reviews) AS reviews
  `)

  const seedCheck = await pool.query(`
    SELECT id, slug, name, created_at
    FROM businesses
    ORDER BY created_at ASC
    LIMIT 5
  `)

  const suffixCounts = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE slug ~ '-[0-9]+$')::int AS with_numeric_suffix,
      COUNT(*) FILTER (WHERE slug !~ '-[0-9]+$')::int AS without_numeric_suffix
    FROM businesses
  `)

  const importPairs = await pool.query(`
    SELECT COUNT(*)::int AS c
    FROM businesses dup
    JOIN businesses orig
      ON dup.slug ~ '-[0-9]+$'
     AND dup.name = orig.name
     AND dup.created_at = orig.created_at
     AND orig.slug = regexp_replace(dup.slug, '-[0-9]+$', '')
  `)

  const multiName = await pool.query(`
    SELECT name, COUNT(*)::int AS c,
           array_agg(slug ORDER BY slug) AS slugs,
           array_agg(created_at ORDER BY slug) AS created_ats,
           array_agg(user_id ORDER BY slug) AS user_ids
    FROM businesses
    GROUP BY name
    HAVING COUNT(*) > 1
    ORDER BY c DESC
    LIMIT 10
  `)

  console.log(JSON.stringify({
    totals: totals.rows[0],
    duplicate_slug_groups: dupSlugs.rowCount,
    duplicate_slug_samples: dupSlugs.rows.slice(0, 5),
    duplicate_name_samples: dupNames.rows,
    duplicate_review_content_groups: dupReviews.rowCount,
    duplicate_review_content_samples: dupReviews.rows.slice(0, 5),
    duplicate_review_biz_user_groups: reviewDupByBizUser.rowCount,
    duplicate_review_biz_user_samples: reviewDupByBizUser.rows.slice(0, 5),
    oldest_businesses: seedCheck.rows,
    suffix_counts: suffixCounts.rows[0],
    import_duplicate_pairs: importPairs.rows[0],
    multi_copy_names: multiName.rows,
  }, null, 2))

  await pool.end()
}

main().catch(async (error) => {
  console.error('FAIL', error.message || error)
  try {
    await pool.end()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
