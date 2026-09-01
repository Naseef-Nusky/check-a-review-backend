import fs from 'fs'
import path from 'path'
import readline from 'readline'
import { query } from './pool.js'
import { slugify } from '../utils/helpers.js'
import { parseInsertLine } from './wpSqlParser.js'
import {
  MEDIA_KIND,
  businessLogoPublicPath,
  mediaService,
} from '../services/media.service.js'

const POSTS_TABLE = 'SERVMASK_PREFIX_posts'
const POSTMETA_TABLE = 'SERVMASK_PREFIX_postmeta'

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function resolveUploadsRoot(inputPath) {
  const resolved = path.resolve(inputPath)
  if (!fs.existsSync(resolved)) {
    throw new Error(`Uploads folder not found: ${resolved}`)
  }

  let current = resolved
  for (let depth = 0; depth < 6; depth += 1) {
    const entries = fs.readdirSync(current)
    const hasYearFolder = entries.some((name) => /^\d{4}$/.test(name))
    if (hasYearFolder) return current

    const nestedUploads = path.join(current, 'uploads')
    if (fs.existsSync(nestedUploads) && fs.statSync(nestedUploads).isDirectory()) {
      current = nestedUploads
      continue
    }
    break
  }

  return resolved
}

async function loadSqlDump(filePath, onLine) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    await onLine(line)
  }
}

function mimeTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_BY_EXT[ext] || null
}

export async function importWordpressLogos({ sqlPath, uploadsPath, dryRun = false }) {
  const uploadsRoot = resolveUploadsRoot(uploadsPath)
  const listings = new Map()
  const postMeta = new Map()

  console.log(`Reading WordPress SQL: ${sqlPath}`)
  console.log(`Uploads root: ${uploadsRoot}`)

  await loadSqlDump(sqlPath, async (line) => {
    let row = parseInsertLine(line, POSTS_TABLE)
    if (row) {
      const post = {
        id: Number(row[0]),
        slug: String(row[11] || ''),
        postType: row[20],
        status: row[7],
        parentId: Number(row[17] || 0),
      }
      if (post.postType === 'listing' && post.status === 'publish' && post.parentId === 0) {
        listings.set(post.id, post)
      }
      return
    }

    row = parseInsertLine(line, POSTMETA_TABLE)
    if (row) {
      const [, postId, metaKey, metaValue] = row
      const id = Number(postId)
      if (!postMeta.has(id)) postMeta.set(id, {})
      postMeta.get(id)[metaKey] = metaValue
    }
  })

  const businesses = await query('SELECT id, slug, name FROM businesses')
  const businessBySlug = new Map(businesses.rows.map((row) => [row.slug, row]))

  const stats = {
    listingsWithThumb: 0,
    filesFound: 0,
    imported: 0,
    skippedNoBusiness: 0,
    skippedNoFile: 0,
    skippedUnsupported: 0,
    skippedHasLogo: 0,
  }

  for (const listing of listings.values()) {
    const meta = postMeta.get(listing.id) || {}
    const thumbId = Number(meta._thumbnail_id || 0)
    if (!thumbId) continue

    stats.listingsWithThumb += 1

    const attachmentMeta = postMeta.get(thumbId) || {}
    const relativePath = attachmentMeta._wp_attached_file
    if (!relativePath) {
      stats.skippedNoFile += 1
      continue
    }

    const filePath = path.join(uploadsRoot, String(relativePath).replace(/\//g, path.sep))
    if (!fs.existsSync(filePath)) {
      stats.skippedNoFile += 1
      continue
    }

    stats.filesFound += 1

    const slug = slugify(listing.slug || listing.id)
    const business = businessBySlug.get(slug)
    if (!business) {
      stats.skippedNoBusiness += 1
      continue
    }

    const existing = await query('SELECT logo_url FROM businesses WHERE id = $1', [business.id])
    if (existing.rows[0]?.logo_url && !dryRun) {
      stats.skippedHasLogo += 1
      continue
    }

    const mimeType = mimeTypeForFile(filePath)
    if (!mimeType) {
      stats.skippedUnsupported += 1
      continue
    }

    if (dryRun) {
      stats.imported += 1
      continue
    }

    const buffer = fs.readFileSync(filePath)
    await mediaService.upsertImage({
      kind: MEDIA_KIND.BUSINESS_LOGO,
      refId: business.id,
      mimeType,
      buffer,
    })

    const logoUrl = businessLogoPublicPath(business.id)
    await query('UPDATE businesses SET logo_url = $1, updated_at = NOW() WHERE id = $2', [
      logoUrl,
      business.id,
    ])

    stats.imported += 1
  }

  return {
    dryRun,
    uploadsRoot,
    source: {
      listings: listings.size,
      listingsWithThumbnail: stats.listingsWithThumb,
    },
    result: stats,
  }
}
