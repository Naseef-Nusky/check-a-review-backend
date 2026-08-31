/**
 * Writes sitemap.xml into the public frontend for static hosting.
 * Run on the server before building the public site:
 *   PUBLIC_SITE_URL=https://checkareview.com npm run sitemap:generate
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { sitemapService } from '../src/services/sitemap.service.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const outPath = path.resolve(__dirname, '../../check-a-review-frontend/public/sitemap.xml')

async function main() {
  const origin = String(process.env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/$/, '')
  if (/localhost|127\.0\.0\.1/i.test(origin)) {
    console.warn(`Warning: PUBLIC_SITE_URL is "${origin}". Set production URL before generating for live SEO.`)
  }

  const xml = await sitemapService.buildXml()
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, xml, 'utf8')
  console.log(`Wrote ${outPath}`)
  console.log(`Sitemap origin: ${origin}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
