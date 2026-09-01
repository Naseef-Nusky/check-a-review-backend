import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { importWordpressLogos } from '../src/db/importWordpressLogos.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const defaultUploads = path.join(__dirname, '..', 'data', 'wp-uploads')
const defaultSql = path.join(process.env.USERPROFILE || '', 'Downloads', 'database.sql')

function usage() {
  console.log(`
Import business logos from WordPress uploads + SQL dump.

Usage:
  npm run db:import-wp-logos -- [uploads-folder] [database.sql] [--dry-run]

Defaults:
  uploads folder: check-a-review-backend/data/wp-uploads
  SQL file:       C:\\Users\\User\\Downloads\\database.sql

Put your WordPress uploads folder here (year folders directly inside):
  check-a-review-backend/data/wp-uploads/
    2022/
    2023/
    2024/

If you copied the whole "uploads" folder, that also works:
  check-a-review-backend/data/wp-uploads/uploads/2022/...

Run the main data import first:
  npm run db:import-wp -- "C:\\Users\\User\\Downloads\\database.sql"
`)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    usage()
    process.exit(0)
  }

  const positional = args.filter((arg) => !arg.startsWith('--'))
  const uploadsPath = positional[0] || defaultUploads
  const sqlPath = positional[1] || defaultSql
  const dryRun = args.includes('--dry-run')

  console.log(dryRun ? 'DRY RUN — no logo writes' : 'LIVE IMPORT — writing logos to PostgreSQL')

  const result = await importWordpressLogos({ sqlPath, uploadsPath, dryRun })
  console.log('\nLogo import summary:')
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

main().catch((error) => {
  console.error('Logo import failed:', error.message || error)
  process.exit(1)
})
