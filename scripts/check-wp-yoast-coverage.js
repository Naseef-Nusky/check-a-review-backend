import fs from 'fs'
import readline from 'readline'
import { parseInsertLine } from '../src/db/wpSqlParser.js'

const sqlPath = process.argv[2] || 'C:\\Users\\User\\Downloads\\database.sql'
const POSTS = 'SERVMASK_PREFIX_posts'
const META = 'SERVMASK_PREFIX_postmeta'

const listings = new Map()
const meta = new Map()

const stream = fs.createReadStream(sqlPath, { encoding: 'utf8' })
for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
  let row = parseInsertLine(line, POSTS)
  if (row) {
    if (row[20] === 'listing' && row[7] === 'publish' && Number(row[17] || 0) === 0) {
      listings.set(Number(row[0]), { title: row[5], slug: row[11] })
    }
    continue
  }
  row = parseInsertLine(line, META)
  if (!row) continue
  const key = String(row[2] || '')
  if (!['_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_focuskw'].includes(key)) continue
  const id = Number(row[1])
  if (!meta.has(id)) meta.set(id, {})
  meta.get(id)[key] = row[3]
}

let withDesc = 0
let withKw = 0
let withTitle = 0
let withCustomTitle = 0
const titleSamples = []
const kwSamples = []
const descOnly = []

for (const [id, listing] of listings) {
  const m = meta.get(id) || {}
  const title = String(m._yoast_wpseo_title || '').trim()
  const desc = String(m._yoast_wpseo_metadesc || '').trim()
  const kw = String(m._yoast_wpseo_focuskw || '').trim()
  if (desc) withDesc += 1
  if (kw) {
    withKw += 1
    if (kwSamples.length < 10) kwSamples.push({ id, name: listing.title, kw })
  }
  if (title) {
    withTitle += 1
    const isTemplate = /%%/.test(title)
    if (!isTemplate) {
      withCustomTitle += 1
      if (titleSamples.length < 10) titleSamples.push({ id, name: listing.title, title })
    }
  }
  if (desc && !kw && !title) {
    if (descOnly.length < 5) descOnly.push({ id, name: listing.title })
  }
}

console.log(
  JSON.stringify(
    {
      publishedListings: listings.size,
      withMetadesc: withDesc,
      withFocusKeyword: withKw,
      withAnyTitleMetaRow: withTitle,
      withCustomTitleNotTemplate: withCustomTitle,
      titleSamples,
      keywordSamples: kwSamples,
      note: 'Most listings only have description; titles use Yoast global template; keywords are rare.',
    },
    null,
    2,
  ),
)
