import dotenv from 'dotenv'
dotenv.config()

import { query, pool } from '../src/db/pool.js'
import { businessService } from '../src/services/business.service.js'

const { rows } = await query('SELECT id FROM businesses ORDER BY created_at')
let updated = 0

for (const row of rows) {
  await businessService.updateBusinessStats(row.id)
  updated += 1
  if (updated % 100 === 0) {
    console.log(`Recalculated stats for ${updated}/${rows.length} businesses...`)
  }
}

const summary = await query(`
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE trust_score > 0)::int AS with_trust_score,
    COUNT(*) FILTER (WHERE review_count > 0)::int AS with_reviews
  FROM businesses
`)

console.log(`Done. Recalculated ${updated} businesses.`)
console.log(summary.rows[0])
await pool.end()
