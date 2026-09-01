import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { importWordpressSql } from '../src/db/importWordpress.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

function usage() {
  console.log(`
Import users, businesses, and reviews from a WordPress (ListingPro) MySQL dump.

Usage:
  node scripts/import-wordpress-sql.js <path-to-database.sql> [--dry-run] [--force]

Options:
  --dry-run   Parse and count only; do not write to PostgreSQL
  --force     Insert even when matching email/slug already exists (default skips duplicates)

Example:
  npm run db:import-wp -- "C:\\Users\\User\\Downloads\\database.sql"
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
  const skipExisting = !args.includes('--force')

  console.log(dryRun ? 'DRY RUN — no database writes' : 'LIVE IMPORT — writing to PostgreSQL')
  console.log(`File: ${filePath}`)
  console.log(`Skip existing duplicates: ${skipExisting}`)

  const result = await importWordpressSql(filePath, { dryRun, skipExisting })
  console.log('\nImport summary:')
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

main().catch((error) => {
  console.error('Import failed:', error)
  process.exit(1)
})
