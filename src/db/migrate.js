import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool } from './pool.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql')
  const schema = fs.readFileSync(schemaPath, 'utf-8')

  console.log('Running database migration...')
  await pool.query(schema)
  console.log('Migration completed successfully.')
  await pool.end()
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
