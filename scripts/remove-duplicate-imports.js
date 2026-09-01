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

function slugRank(slug) {
  const match = slug.match(/-(\d+)$/)
  return match ? Number(match[1]) : 0
}

async function main() {
  const dryRun = !process.argv.includes('--apply')

  const groups = await pool.query(`
    SELECT
      name,
      created_at,
      user_id,
      COUNT(*)::int AS c,
      array_agg(id ORDER BY slug) AS ids,
      array_agg(slug ORDER BY slug) AS slugs
    FROM businesses
    GROUP BY name, created_at, user_id
    HAVING COUNT(*) > 1
    ORDER BY c DESC, name
  `)

  const toDelete = []
  const toKeep = []

  for (const group of groups.rows) {
    const ranked = group.slugs
      .map((slug, index) => ({ slug, id: group.ids[index], rank: slugRank(slug), len: slug.length }))
      .sort((a, b) => a.rank - b.rank || a.len - b.len || a.slug.localeCompare(b.slug))

    toKeep.push(ranked[0])
    for (let i = 1; i < ranked.length; i += 1) {
      toDelete.push(ranked[i])
    }
  }

  const reviewCount = await pool.query(
    `SELECT COUNT(*)::int AS c FROM reviews WHERE business_id = ANY($1::uuid[])`,
    [toDelete.map((row) => row.id)],
  )

  console.log(
    JSON.stringify(
      {
        dryRun,
        duplicate_groups: groups.rowCount,
        businesses_to_delete: toDelete.length,
        businesses_to_keep_from_groups: toKeep.length,
        reviews_on_deleted_businesses: reviewCount.rows[0].c,
        sample_deletes: toDelete.slice(0, 8).map((row) => row.slug),
      },
      null,
      2,
    ),
  )

  if (dryRun) {
    await pool.end()
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const deleteIds = toDelete.map((row) => row.id)
    if (deleteIds.length > 0) {
      await client.query('DELETE FROM businesses WHERE id = ANY($1::uuid[])', [deleteIds])
    }

    await client.query(`
      UPDATE businesses b
      SET review_count = stats.c,
          average_rating = stats.avg_rating,
          updated_at = NOW()
      FROM (
        SELECT business_id,
               COUNT(*)::int AS c,
               COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS avg_rating
        FROM reviews
        WHERE status = 'published'
        GROUP BY business_id
      ) stats
      WHERE b.id = stats.business_id
    `)

    await client.query(`
      UPDATE businesses
      SET review_count = 0,
          average_rating = 0,
          updated_at = NOW()
      WHERE id NOT IN (SELECT DISTINCT business_id FROM reviews)
    `)

    await client.query('COMMIT')
    console.log('Removed duplicate businesses successfully.')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
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
