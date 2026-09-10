import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

const r = await pool.query(
  `SELECT site_name, seo_title, seo_description, seo_keywords
   FROM website_settings
   ORDER BY updated_at DESC NULLS LAST, id ASC
   LIMIT 1`,
)
console.log(JSON.stringify(r.rows[0] || null, null, 2))
await pool.end()
