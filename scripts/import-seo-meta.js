/**
 * Apply scripts/import-seo-meta.sql
 *   npm run db:import-seo
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sqlPath = path.join(__dirname, 'import-seo-meta.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})

try {
  await pool.query(sql)
  console.log('SEO meta columns imported and homepage SEO seeded from import-seo-meta.sql')
} finally {
  await pool.end()
}
