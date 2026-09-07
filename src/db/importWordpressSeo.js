/**
 * Import Yoast SEO meta from a WordPress ListingPro dump into businesses.seo_*.
 * Matches listings by slug (same as db:import-wp), then name.
 */
import fs from 'fs'
import readline from 'readline'
import { pool, query } from './pool.js'
import { slugify } from '../utils/helpers.js'
import { parseInsertLine } from './wpSqlParser.js'
import { ensureBusinessSeoColumns } from '../utils/seoMeta.js'

const POSTS_TABLE = 'SERVMASK_PREFIX_posts'
const POSTMETA_TABLE = 'SERVMASK_PREFIX_postmeta'

const YOAST_TITLE = '_yoast_wpseo_title'
const YOAST_DESC = '_yoast_wpseo_metadesc'
const YOAST_KW = '_yoast_wpseo_focuskw'

function cleanText(value) {
  const text = String(value || '')
    .replace(/%%[^%]+%%/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

function isTemplateTitle(value) {
  const raw = String(value || '').trim()
  if (!raw) return true
  return /%%/.test(raw)
}

async function loadSqlDump(filePath, onLine) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    await onLine(line)
  }
}

export async function importWordpressSeo(filePath, options = {}) {
  const dryRun = Boolean(options.dryRun)
  const force = Boolean(options.force)

  const listings = []
  const postMeta = new Map()

  console.log(`Reading WordPress dump for Yoast SEO: ${filePath}`)

  await loadSqlDump(filePath, async (line) => {
    let row = parseInsertLine(line, POSTS_TABLE)
    if (row) {
      const post = {
        id: Number(row[0]),
        title: String(row[5] || ''),
        status: row[7],
        slug: String(row[11] || ''),
        parentId: Number(row[17] || 0),
        postType: row[20],
      }
      if (post.postType === 'listing' && post.status === 'publish' && post.parentId === 0) {
        listings.push(post)
      }
      return
    }

    row = parseInsertLine(line, POSTMETA_TABLE)
    if (row) {
      const [, postId, metaKey, metaValue] = row
      const key = String(metaKey || '')
      if (key !== YOAST_TITLE && key !== YOAST_DESC && key !== YOAST_KW) return
      const id = Number(postId)
      if (!postMeta.has(id)) postMeta.set(id, {})
      postMeta.get(id)[key] = metaValue
    }
  })

  const candidates = []
  for (const listing of listings) {
    const meta = postMeta.get(listing.id) || {}
    const seoTitle = isTemplateTitle(meta[YOAST_TITLE]) ? null : cleanText(meta[YOAST_TITLE])
    const seoDescription = cleanText(meta[YOAST_DESC])
    const seoKeywords = cleanText(meta[YOAST_KW])
    if (!seoTitle && !seoDescription && !seoKeywords) continue
    candidates.push({
      wpId: listing.id,
      title: listing.title,
      slug: slugify(listing.slug || listing.title) || null,
      seoTitle,
      seoDescription,
      seoKeywords,
    })
  }

  console.log(`Published listings: ${listings.length}`)
  console.log(`Listings with Yoast SEO text: ${candidates.length}`)

  await ensureBusinessSeoColumns()

  const stats = {
    matchedBySlug: 0,
    matchedByName: 0,
    updated: 0,
    skippedNoMatch: 0,
    skippedAlreadySet: 0,
    dryRunWouldUpdate: 0,
  }
  const unmatched = []

  const client = await pool.connect()
  try {
    for (const item of candidates) {
      let business = null
      let matchHow = null

      if (item.slug) {
        const bySlug = await client.query(
          `SELECT id, name, slug, seo_title, seo_description, seo_keywords
           FROM businesses WHERE slug = $1 LIMIT 1`,
          [item.slug],
        )
        if (bySlug.rows[0]) {
          business = bySlug.rows[0]
          matchHow = 'slug'
        }
      }

      if (!business && item.title) {
        const byName = await client.query(
          `SELECT id, name, slug, seo_title, seo_description, seo_keywords
           FROM businesses
           WHERE lower(name) = lower($1)
           ORDER BY updated_at DESC
           LIMIT 2`,
          [item.title],
        )
        if (byName.rows.length === 1) {
          business = byName.rows[0]
          matchHow = 'name'
        }
      }

      if (!business) {
        stats.skippedNoMatch += 1
        if (unmatched.length < 25) {
          unmatched.push({ wpId: item.wpId, title: item.title, slug: item.slug })
        }
        continue
      }

      if (matchHow === 'slug') stats.matchedBySlug += 1
      else stats.matchedByName += 1

      const nextTitle = force
        ? item.seoTitle ?? business.seo_title
        : business.seo_title || item.seoTitle
      const nextDescription = force
        ? item.seoDescription ?? business.seo_description
        : business.seo_description || item.seoDescription
      const nextKeywords = force
        ? item.seoKeywords ?? business.seo_keywords
        : business.seo_keywords || item.seoKeywords

      const changed =
        nextTitle !== (business.seo_title || null) ||
        nextDescription !== (business.seo_description || null) ||
        nextKeywords !== (business.seo_keywords || null)

      if (!changed) {
        stats.skippedAlreadySet += 1
        continue
      }

      if (dryRun) {
        stats.dryRunWouldUpdate += 1
        continue
      }

      await client.query(
        `UPDATE businesses SET
          seo_title = $1,
          seo_description = $2,
          seo_keywords = $3,
          updated_at = NOW()
         WHERE id = $4`,
        [nextTitle || null, nextDescription || null, nextKeywords || null, business.id],
      )
      stats.updated += 1
    }
  } finally {
    client.release()
  }

  return {
    listings: listings.length,
    withYoast: candidates.length,
    ...stats,
    unmatchedSample: unmatched,
  }
}
