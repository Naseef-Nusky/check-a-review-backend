/**
 * Writes sitemap.xml into the business frontend for static hosting.
 * Run on the server before building the business site:
 *   BUSINESS_PORTAL_URL=https://business.checkareview.com npm run sitemap:generate:business
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { businessSitemapService } from '../src/services/businessSitemap.service.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const outPath = path.resolve(__dirname, '../../check-a-business-frontend/public/sitemap.xml')

async function main() {
  const origin = String(process.env.BUSINESS_PORTAL_URL || 'http://localhost:5175').replace(/\/$/, '')
  if (/localhost|127\.0\.0\.1/i.test(origin)) {
    console.warn(`Warning: BUSINESS_PORTAL_URL is "${origin}". Set production URL before generating for live SEO.`)
  }

  const xml = businessSitemapService.buildXml()
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
