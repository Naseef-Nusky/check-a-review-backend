import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

const r = await pool.query(
  `SELECT name, slug, website, status
   FROM businesses
   WHERE slug = $1 OR name ILIKE $2
   LIMIT 10`,
  ['carpenter-handyman', '%carpenter%handyman%'],
)
console.log(JSON.stringify(r.rows, null, 2))

const counts = await pool.query(`
  SELECT
    COUNT(*)::int AS published,
    COUNT(*) FILTER (WHERE COALESCE(TRIM(website), '') <> '')::int AS with_website,
    COUNT(*) FILTER (WHERE COALESCE(TRIM(website), '') = '')::int AS without_website
  FROM businesses
  WHERE status = 'published'
`)
console.log('counts', counts.rows[0])
await pool.end()
