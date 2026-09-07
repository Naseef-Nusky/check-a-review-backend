import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { importWordpressSeo } from '../src/db/importWordpressSeo.js'
import { pool } from '../src/db/pool.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

function usage() {
  console.log(`
Import Yoast SEO meta (title / description / focus keyword) from a WordPress dump
into Check A Review businesses (seo_title, seo_description, seo_keywords).

Matches by listing slug (same as db:import-wp), then unique business name.

Usage:
  node scripts/import-wordpress-seo.js <path-to-database.sql> [--dry-run] [--force]

Options:
  --dry-run   Parse + match only; do not write
  --force     Overwrite existing CRM SEO fields (default only fills empty fields)

Example:
  npm run db:import-wp-seo -- "C:\\Users\\User\\Downloads\\database.sql"
  npm run db:import-wp-seo -- "C:\\Users\\User\\Downloads\\database.sql" --dry-run
`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    usage()
    process.exit(args.length === 0 ? 1 : 0)
  }

  const filePath = args.find((arg) => !arg.startsWith('--'))
  if (!filePath) {
    usage()
    process.exit(1)
  }

  const dryRun = args.includes('--dry-run')
  const force = args.includes('--force')

  console.log(dryRun ? 'DRY RUN — no database writes' : 'LIVE IMPORT — writing Yoast SEO into PostgreSQL')
  console.log(`File: ${filePath}`)
  console.log(`Overwrite existing SEO: ${force}`)

  const result = await importWordpressSeo(filePath, { dryRun, force })
  console.log('\nYoast SEO import summary:')
  console.log(JSON.stringify(result, null, 2))
  await pool.end()
  process.exit(0)
}

main().catch(async (error) => {
  console.error('Yoast SEO import failed:', error.message || error)
  try {
    await pool.end()
  } catch {
    // ignore
  }
  process.exit(1)
})
