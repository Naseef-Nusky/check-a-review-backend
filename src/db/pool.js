import pg from 'pg'
import { env } from '../config/env.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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
