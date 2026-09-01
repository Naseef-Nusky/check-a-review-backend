import fs from 'fs'
import readline from 'readline'
import { randomUUID } from 'crypto'
import { pool, query } from './pool.js'
import { slugify } from '../utils/helpers.js'
import { parseInsertLine, readPhpString, stripHtml } from './wpSqlParser.js'

const USERS_TABLE = 'SERVMASK_PREFIX_users'
const POSTS_TABLE = 'SERVMASK_PREFIX_posts'
const POSTMETA_TABLE = 'SERVMASK_PREFIX_postmeta'
const TERMS_TABLE = 'SERVMASK_PREFIX_terms'
const TERM_TAXONOMY_TABLE = 'SERVMASK_PREFIX_term_taxonomy'
const TERM_REL_TABLE = 'SERVMASK_PREFIX_term_relationships'
const USERMETA_TABLE = 'SERVMASK_PREFIX_usermeta'

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function normalizeWebsite(url) {
  const value = String(url || '').trim()
  if (!value) return null
  if (/^https?:\/\//i.test(value)) return value
  return `https://${value}`
}

function resolveListingOwnerWpId(listing, meta, wpUsers, wpAdmins) {
  const authorId = listing.authorId
  if (authorId && wpUsers.has(authorId) && !wpAdmins.has(authorId)) {
    return { wpUserId: authorId, synthetic: false }
  }

  const options = meta.lp_listingpro_options || ''
  const listingEmail = normalizeEmail(readPhpString(options, 'email'))
  if (listingEmail) {
    for (const [id, user] of wpUsers.entries()) {
      if (user.email === listingEmail && !wpAdmins.has(id)) {
        return { wpUserId: id, synthetic: false }
      }
    }
    return {
      wpUserId: null,
      synthetic: true,
      email: listingEmail,
      name: String(listing.title).slice(0, 255),
    }
  }

  return {
    wpUserId: null,
    synthetic: true,
    email: `import+listing${listing.id}@checkareview.local`,
    name: String(listing.title).slice(0, 255),
  }
}

async function upsertAppUser(client, { email, role, name, passwordHash, registered }) {
  const emailLower = normalizeEmail(email)
  if (!emailLower) return null

  const id = randomUUID()
  const result = await client.query(
    `INSERT INTO users (id, email, password_hash, name, role, email_verified, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, COALESCE($6::timestamptz, NOW()), COALESCE($6::timestamptz, NOW()))
     ON CONFLICT (email, role) DO UPDATE SET updated_at = users.updated_at
     RETURNING id`,
    [id, emailLower, passwordHash || null, String(name || emailLower).slice(0, 255), role, registered || null],
  )
  return result.rows[0]?.id || null
}

async function ensureBusinessUser(client, {
  dryRun,
  wpUsers,
  userIdMap,
  owner,
  stats,
}) {
  if (owner.wpUserId) {
    let uuid = userIdMap.business.get(owner.wpUserId)
    if (uuid) return uuid

    const wpUser = wpUsers.get(owner.wpUserId)
    if (!dryRun) {
      uuid = await upsertAppUser(client, {
        email: wpUser.email,
        role: 'business',
        name: wpUser.displayName,
        passwordHash: wpUser.passwordHash,
        registered: wpUser.registered,
      })
      if (uuid) userIdMap.business.set(owner.wpUserId, uuid)
      stats.usersBusiness += 1
      return uuid
    }

    uuid = randomUUID()
    userIdMap.business.set(owner.wpUserId, uuid)
    stats.usersBusiness += 1
    return uuid
  }

  const email = owner.email
  const syntheticKey = `synthetic:${email}`
  let uuid = userIdMap.business.get(syntheticKey)
  if (uuid) return uuid

  if (!dryRun) {
    uuid = await upsertAppUser(client, {
      email,
      role: 'business',
      name: owner.name,
      passwordHash: null,
    })
    if (uuid) userIdMap.business.set(syntheticKey, uuid)
    stats.usersBusiness += 1
    return uuid
  }

  uuid = randomUUID()
  userIdMap.business.set(syntheticKey, uuid)
  stats.usersBusiness += 1
  return uuid
}

function uniqueSlug(base, used) {
  let slug = slugify(base) || 'business'
  let candidate = slug
  let n = 2
  while (used.has(candidate)) {
    candidate = `${slug}-${n}`
    n += 1
  }
  used.add(candidate)
  return candidate
}

async function loadSqlDump(filePath, onLine) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })
  for await (const line of rl) {
    await onLine(line)
  }
}

export async function importWordpressSql(filePath, options = {}) {
  const dryRun = Boolean(options.dryRun)
  const skipExisting = options.skipExisting !== false

  const wpUsers = new Map()
  const wpAdmins = new Set()
  const posts = []
  const postMeta = new Map()
  const terms = new Map()
  const termTaxonomy = new Map()
  const termRelationships = new Map()
  const listingAuthors = new Set()
  const reviewAuthors = new Set()

  console.log(`Reading WordPress dump: ${filePath}`)

  await loadSqlDump(filePath, async (line) => {
    let row

    row = parseInsertLine(line, USERS_TABLE)
    if (row) {
      const [id, , , , email, , registered, , , displayName] = row
      wpUsers.set(Number(id), {
        id: Number(id),
        email: normalizeEmail(email),
        displayName: String(displayName || email || `User ${id}`),
        registered,
        passwordHash: row[2] || null,
      })
      return
    }

    row = parseInsertLine(line, USERMETA_TABLE)
    if (row) {
      const [, userId, metaKey, metaValue] = row
      if (String(metaKey).includes('capabilities') && String(metaValue).includes('administrator')) {
        wpAdmins.add(Number(userId))
      }
      return
    }

    row = parseInsertLine(line, POSTS_TABLE)
    if (row) {
      const post = {
        id: Number(row[0]),
        authorId: Number(row[1]),
        postDate: row[2],
        content: row[4],
        title: row[5],
        status: row[7],
        slug: row[11],
        parentId: Number(row[17] || 0),
        postType: row[20],
      }
      posts.push(post)
      if (post.postType === 'listing' && post.status === 'publish' && post.parentId === 0) {
        listingAuthors.add(post.authorId)
      }
      if (post.postType === 'lp-reviews' && post.status === 'publish') {
        reviewAuthors.add(post.authorId)
      }
      return
    }

    row = parseInsertLine(line, POSTMETA_TABLE)
    if (row) {
      const [, postId, metaKey, metaValue] = row
      const key = Number(postId)
      if (!postMeta.has(key)) postMeta.set(key, {})
      postMeta.get(key)[metaKey] = metaValue
      return
    }

    row = parseInsertLine(line, TERMS_TABLE)
    if (row) {
      const [termId, name] = row
      terms.set(Number(termId), String(name))
      return
    }

    row = parseInsertLine(line, TERM_TAXONOMY_TABLE)
    if (row) {
      const [termTaxonomyId, termId, taxonomy] = row
      termTaxonomy.set(Number(termTaxonomyId), {
        termId: Number(termId),
        taxonomy: String(taxonomy),
      })
      return
    }

    row = parseInsertLine(line, TERM_REL_TABLE)
    if (row) {
      const [objectId, termTaxonomyId] = row
      const listingId = Number(objectId)
      if (!termRelationships.has(listingId)) termRelationships.set(listingId, [])
      termRelationships.get(listingId).push(Number(termTaxonomyId))
    }
  })

  const listings = posts.filter(
    (p) => p.postType === 'listing' && p.status === 'publish' && p.parentId === 0,
  )
  const reviews = posts.filter((p) => p.postType === 'lp-reviews' && p.status === 'publish')

  const categoryByListing = new Map()
  for (const listing of listings) {
    const rels = termRelationships.get(listing.id) || []
    for (const taxonomyId of rels) {
      const tax = termTaxonomy.get(taxonomyId)
      if (!tax || tax.taxonomy !== 'listing-category') continue
      const name = terms.get(tax.termId)
      if (name) {
        categoryByListing.set(listing.id, name.slice(0, 100))
        break
      }
    }
  }

  const stats = {
    usersCustomer: 0,
    usersBusiness: 0,
    usersSkipped: 0,
    businesses: 0,
    reviews: 0,
    reviewsSkipped: 0,
    subscriptions: 0,
  }

  const userIdMap = {
    customer: new Map(),
    business: new Map(),
  }
  const businessIdMap = new Map()
  const usedSlugs = new Set()

  if (!dryRun) {
    const existingSlugs = await query('SELECT slug FROM businesses')
    for (const row of existingSlugs.rows) usedSlugs.add(row.slug)
  }

  const client = dryRun ? null : await pool.connect()

  try {
    if (!dryRun) await client.query('BEGIN')

    for (const wpUser of wpUsers.values()) {
      if (wpAdmins.has(wpUser.id) || !wpUser.email) {
        stats.usersSkipped += 1
        continue
      }

      const roles = []
      if (reviewAuthors.has(wpUser.id)) roles.push('customer')
      if (listingAuthors.has(wpUser.id)) roles.push('business')
      if (roles.length === 0) roles.push('customer')

      for (const role of roles) {
        if (!dryRun) {
          const id = await upsertAppUser(client, {
            email: wpUser.email,
            role,
            name: wpUser.displayName,
            passwordHash: wpUser.passwordHash,
            registered: wpUser.registered,
          })
          if (id) userIdMap[role].set(wpUser.id, id)
        } else {
          userIdMap[role].set(wpUser.id, randomUUID())
        }

        if (role === 'customer') stats.usersCustomer += 1
        if (role === 'business') stats.usersBusiness += 1
      }
    }

    for (const listing of listings) {
      const meta = postMeta.get(listing.id) || {}
      const owner = resolveListingOwnerWpId(listing, meta, wpUsers, wpAdmins)
      const ownerUuid = await ensureBusinessUser(client, {
        dryRun,
        wpUsers,
        userIdMap,
        owner,
        stats,
      })

      if (!ownerUuid) {
        console.warn(`Skipping listing ${listing.id} (${listing.title}) — no business owner`)
        continue
      }
      const options = meta.lp_listingpro_options || ''
      const baseSlug = slugify(listing.slug || listing.title) || 'business'
      const averageRating = Number(meta.listing_rate || 0)
      const reviewCount = Number(meta.listing_reviewed || 0)

      if (!dryRun && skipExisting) {
        const existing = await client.query(
          `SELECT id FROM businesses
           WHERE slug = $1
              OR (name = $2 AND created_at = $3::timestamptz AND user_id = $4)
           ORDER BY CASE WHEN slug = $1 THEN 0 ELSE 1 END, slug
           LIMIT 1`,
          [
            baseSlug,
            String(listing.title).slice(0, 255),
            listing.postDate || new Date().toISOString(),
            ownerUuid,
          ],
        )
        if (existing.rows.length > 0) {
          businessIdMap.set(listing.id, existing.rows[0].id)
          continue
        }
      }

      const slug = uniqueSlug(listing.slug || listing.title, usedSlugs)
      const businessUuid = randomUUID()
      businessIdMap.set(listing.id, businessUuid)

      if (!dryRun) {
        await client.query(
          `INSERT INTO businesses (
            id, user_id, name, slug, category, description, website, email, phone, address,
            status, average_rating, review_count, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
            'published', $11, $12, $13::timestamp, $13::timestamp
          )`,
          [
            businessUuid,
            ownerUuid,
            String(listing.title).slice(0, 255),
            slug,
            categoryByListing.get(listing.id) || 'General',
            stripHtml(listing.content).slice(0, 5000) || String(listing.title),
            normalizeWebsite(readPhpString(options, 'website')),
            readPhpString(options, 'email') || null,
            readPhpString(options, 'phone') || null,
            readPhpString(options, 'gAddress') || null,
            Number.isFinite(averageRating) ? averageRating : 0,
            Number.isFinite(reviewCount) ? reviewCount : 0,
            listing.postDate || new Date().toISOString(),
          ],
        )

        await client.query(
          `INSERT INTO subscriptions (business_id, plan, status)
           VALUES ($1, 'free', 'active')
           ON CONFLICT (business_id) DO NOTHING`,
          [businessUuid],
        )
        stats.subscriptions += 1
      }

      stats.businesses += 1
    }

    for (const review of reviews) {
      const meta = postMeta.get(review.id) || {}
      const options = meta.lp_listingpro_options || ''
      const listingId = Number(readPhpString(options, 'listing_id') || meta.listing_id || 0)
      const businessUuid = businessIdMap.get(listingId)
      if (!businessUuid) {
        stats.reviewsSkipped += 1
        continue
      }

      let customerUuid = null
      const wpUser = wpUsers.get(review.authorId)
      if (wpUser?.email && !wpAdmins.has(review.authorId)) {
        if (!dryRun) {
          customerUuid = await upsertAppUser(client, {
            email: wpUser.email,
            role: 'customer',
            name: wpUser.displayName,
            passwordHash: wpUser.passwordHash,
            registered: wpUser.registered,
          })
          if (customerUuid) userIdMap.customer.set(review.authorId, customerUuid)
        } else {
          customerUuid = userIdMap.customer.get(review.authorId) || randomUUID()
          userIdMap.customer.set(review.authorId, customerUuid)
        }
      }

      if (!customerUuid) {
        stats.reviewsSkipped += 1
        continue
      }

      const rating = Math.min(5, Math.max(1, Number(meta.rating || readPhpString(options, 'rating') || 5)))
      const title = stripHtml(review.title).slice(0, 255) || 'Review'
      const content = stripHtml(review.content).slice(0, 5000) || title
      const reply = stripHtml(readPhpString(options, 'review_reply'))
      const reviewUuid = randomUUID()

      if (!dryRun) {
        await client.query(
          `INSERT INTO reviews (
            id, business_id, user_id, rating, title, content, status,
            business_reply, business_reply_at, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, 'published', $7::text,
            CASE WHEN $7::text IS NULL OR $7::text = '' THEN NULL ELSE NOW() END,
            $8::timestamptz, $8::timestamptz
          )
          ON CONFLICT (business_id, user_id) DO NOTHING`,
          [
            reviewUuid,
            businessUuid,
            customerUuid,
            rating,
            title,
            content,
            reply || null,
            review.postDate || new Date().toISOString(),
          ],
        )
      }

      stats.reviews += 1
    }

    if (!dryRun) await client.query('COMMIT')
  } catch (error) {
    if (!dryRun) await client.query('ROLLBACK')
    throw error
  } finally {
    if (client) client.release()
  }

  return {
    dryRun,
    source: {
      wpUsers: wpUsers.size,
      listings: listings.length,
      reviews: reviews.length,
      adminsSkipped: wpAdmins.size,
    },
    imported: stats,
  }
}
