import pg from 'pg'
import { env } from '../config/env.js'

const { Pool } = pg

const useSsl =
  env.DATABASE_SSL === 'true' ||
  String(env.DATABASE_URL).includes('sslmode=require') ||
  env.NODE_ENV === 'production'

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
})

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err)
})

export async function query(text, params) {
  const start = Date.now()
  const result = await pool.query(text, params)
  const duration = Date.now() - start
  if (env.NODE_ENV === 'development') {
    console.log('Query executed', { text: text.substring(0, 80), duration, rows: result.rowCount })
  }
  return result
}
