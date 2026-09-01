import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const { Pool } = pg
const useSsl = process.env.DATABASE_SSL === 'true'
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
})

async function count(sql) {
  const result = await pool.query(sql)
  return Number(result.rows[0].count)
}

async function main() {
  const stats = {
    users_total: await count('SELECT COUNT(*)::int AS count FROM users'),
    users_customer: await count("SELECT COUNT(*)::int AS count FROM users WHERE role = 'customer'"),
    users_business: await count("SELECT COUNT(*)::int AS count FROM users WHERE role = 'business'"),
    users_admin: await count(
      "SELECT COUNT(*)::int AS count FROM users WHERE role IN ('super_admin', 'admin', 'viewer')",
    ),
    businesses_total: await count('SELECT COUNT(*)::int AS count FROM businesses'),
    businesses_published: await count(
      "SELECT COUNT(*)::int AS count FROM businesses WHERE status = 'published'",
    ),
    reviews_total: await count('SELECT COUNT(*)::int AS count FROM reviews'),
    reviews_published: await count(
      "SELECT COUNT(*)::int AS count FROM reviews WHERE status = 'published'",
    ),
    businesses_with_logo: await count(
      "SELECT COUNT(*)::int AS count FROM businesses WHERE logo_url IS NOT NULL AND logo_url <> ''",
    ),
  }

  try {
    stats.stored_logos = await count(
      "SELECT COUNT(*)::int AS count FROM stored_images WHERE kind = 'business_logo'",
    )
  } catch {
    stats.stored_logos = null
  }

  console.log(JSON.stringify(stats, null, 2))
  await pool.end()
}

main().catch(async (error) => {
  console.error('FAIL', error.code || '', error.message || error)
  try {
    await pool.end()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
