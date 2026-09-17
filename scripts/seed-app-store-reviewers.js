/**
 * Seed App Store review demo accounts (idempotent).
 *
 * Usage: node scripts/seed-app-store-reviewers.js
 */
import bcrypt from 'bcryptjs'
import { pool, query } from '../src/db/pool.js'
import { slugify } from '../src/utils/helpers.js'

const PASSWORD = 'AppleReview!26'

const CUSTOMER = {
  email: 'apple.reviewer@checkareview.com',
  name: 'Alex Morgan',
  bio: 'Independent reviewer based in Manchester. I leave honest feedback after using a service.',
  phone: '+44 7700 900221',
}

const BUSINESS_OWNER = {
  email: 'apple.business@checkareview.com',
  name: 'James Thornton',
  phone: '+44 161 833 0001',
}

const BUSINESS = {
  name: 'Thornton & Hale Associates',
  slug: 'thornton-hale-associates',
  category: 'Sales & Marketing',
  website: 'https://thorntonhale.example.com',
  email: 'hello@thorntonhale.example.com',
  phone: '+44 161 833 0001',
  brandColor: '#0F172A',
  description: [
    'Independent marketing consultancy helping UK companies improve reputation, reviews, and customer trust.',
    'Location: Manchester',
    'Address: 125 Deansgate',
    'ZIP / Postal code: M3 2BY',
    'Job title: Managing Director',
    'Annual revenue: £500K - £4.99 million',
    'Employees: 10-49',
    'Contact: James Thornton',
  ].join('\n'),
}

const APPLE_REVIEW = {
  rating: 5,
  title: 'Clear advice and a professional team',
  content:
    'We hired Thornton & Hale to tidy up our online reviews and brand messaging. The team explained every step, kept to the timeline, and the work was easy to follow. I would use them again.',
  reply:
    'Thank you, Alex. We are glad the project was straightforward and that the recommendations were useful. James Thornton, Managing Director.',
}

const EXTRA_REVIEWS = [
  {
    email: 'priya.appledemo@checkareview.com',
    name: 'Priya Shah',
    rating: 5,
    title: 'Helpful from the first call',
    content:
      'The first consultation was practical and honest. They did not oversell, and the follow-up notes were clear.',
    reply:
      'Thank you Priya. We always try to be direct in the first conversation so you know exactly what to expect.',
  },
  {
    email: 'daniel.appledemo@checkareview.com',
    name: 'Daniel Reed',
    rating: 4,
    title: 'Solid work, slightly slower than hoped',
    content:
      'The strategy document was strong and we have already used several of the ideas. Delivery slipped by a few days, but communication stayed good.',
    reply:
      'Thanks for the balanced review, Daniel. We have tightened our handover timeline so later projects stay on the original date.',
  },
]

async function ensureUser({ email, name, role, bio = null, phone = null, passwordHash }) {
  const existing = await query(`SELECT id FROM users WHERE email = $1 AND role = $2`, [email, role])
  if (existing.rows[0]) {
    await query(
      `UPDATE users
       SET name = $1,
           password_hash = $2,
           email_verified = TRUE,
           bio = COALESCE($3, bio),
           phone = COALESCE($4, phone),
           updated_at = NOW()
       WHERE id = $5`,
      [name, passwordHash, bio, phone, existing.rows[0].id],
    )
    return existing.rows[0].id
  }
  const inserted = await query(
    `INSERT INTO users (email, password_hash, name, role, email_verified, bio, phone)
     VALUES ($1, $2, $3, $4, TRUE, $5, $6)
     RETURNING id`,
    [email, passwordHash, name, role, bio, phone],
  )
  return inserted.rows[0].id
}

async function upsertReview({ businessId, userId, rating, title, content, reply, createdAt }) {
  const existing = await query(
    `SELECT id FROM reviews WHERE business_id = $1 AND user_id = $2 LIMIT 1`,
    [businessId, userId],
  )
  const replyText = reply || null
  if (existing.rows[0]) {
    await query(
      `UPDATE reviews
       SET rating = $1,
           title = $2,
           content = $3,
           status = 'published',
           business_reply = $4::text,
           business_reply_at = CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() END,
           updated_at = NOW()
       WHERE id = $5`,
      [rating, title, content, replyText, existing.rows[0].id],
    )
    return existing.rows[0].id
  }
  const inserted = await query(
    `INSERT INTO reviews (
       business_id, user_id, rating, title, content, status, business_reply, business_reply_at, created_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'published', $6::text,
       CASE WHEN $6::text IS NULL THEN NULL ELSE NOW() END,
       $7
     )
     RETURNING id`,
    [businessId, userId, rating, title, content, replyText, createdAt || new Date()],
  )
  return inserted.rows[0].id
}

async function seed() {
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS claimed BOOLEAN NOT NULL DEFAULT false`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS verified_contact BOOLEAN NOT NULL DEFAULT false`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS verified_identity BOOLEAN NOT NULL DEFAULT false`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS verified_ownership BOOLEAN NOT NULL DEFAULT false`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_color VARCHAR(20)`)

  const passwordHash = await bcrypt.hash(PASSWORD, 12)
  const customerId = await ensureUser({ ...CUSTOMER, role: 'customer', passwordHash })
  const ownerId = await ensureUser({ ...BUSINESS_OWNER, role: 'business', passwordHash })

  const existingBiz = await query(
    `SELECT id FROM businesses WHERE slug = $1 OR email = $2 OR user_id = $3 LIMIT 1`,
    [BUSINESS.slug, BUSINESS.email, ownerId],
  )

  let businessId = existingBiz.rows[0]?.id || null
  const bizFields = [
    ownerId,
    BUSINESS.name,
    BUSINESS.slug,
    BUSINESS.category,
    BUSINESS.description,
    BUSINESS.website,
    BUSINESS.email,
    BUSINESS.phone,
    BUSINESS.brandColor,
  ]

  if (businessId) {
    await query(
      `UPDATE businesses
       SET user_id = $1,
           name = $2,
           slug = $3,
           category = $4,
           description = $5,
           website = $6,
           email = $7,
           phone = $8,
           brand_color = $9,
           status = 'published',
           claimed = TRUE,
           claimed_at = COALESCE(claimed_at, NOW()),
           verified_contact = TRUE,
           verified_identity = TRUE,
           verified_ownership = TRUE,
           updated_at = NOW()
       WHERE id = $10`,
      [...bizFields, businessId],
    )
  } else {
    const inserted = await query(
      `INSERT INTO businesses (
         user_id, name, slug, category, description, website, email, phone, brand_color,
         status, claimed, claimed_at, verified_contact, verified_identity, verified_ownership
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published', TRUE, NOW(), TRUE, TRUE, TRUE)
       RETURNING id`,
      bizFields,
    )
    businessId = inserted.rows[0].id
  }

  await query(
    `INSERT INTO subscriptions (business_id, plan, status)
     VALUES ($1, 'starter', 'active')
     ON CONFLICT (business_id) DO UPDATE
       SET plan = 'starter', status = 'active', updated_at = NOW()`,
    [businessId],
  )

  await query(
    `INSERT INTO business_members (business_id, user_id, email, role, status, accepted_at)
     VALUES ($1, $2, $3, 'owner', 'active', NOW())
     ON CONFLICT (business_id, email) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           role = 'owner',
           status = 'active',
           accepted_at = COALESCE(business_members.accepted_at, NOW()),
           updated_at = NOW()`,
    [businessId, ownerId, BUSINESS_OWNER.email.toLowerCase()],
  )

  await query(
    `INSERT INTO business_domains (business_id, domain, is_primary, status)
     VALUES ($1, $2, TRUE, 'active')
     ON CONFLICT (business_id, domain) DO UPDATE
       SET is_primary = TRUE, status = 'active', updated_at = NOW()`,
    [businessId, 'thorntonhale.example.com'],
  )

  const claimExists = await query(
    `SELECT id FROM business_claims WHERE business_id = $1 AND email = $2 LIMIT 1`,
    [businessId, BUSINESS_OWNER.email],
  )
  if (!claimExists.rows[0]) {
    await query(
      `INSERT INTO business_claims (
         business_id, full_name, email, phone, job_title, relationship, verification_info,
         status, email_verified, email_verified_at, contact_status, ownership_status, identity_status,
         user_id, reviewed_at
       ) VALUES (
         $1, $2, $3, $4, 'Managing Director', 'Owner',
         'Companies House listing and matching business email for App Store demo.',
         'approved', TRUE, NOW(), 'verified', 'verified', 'verified', $5, NOW()
       )`,
      [businessId, BUSINESS_OWNER.name, BUSINESS_OWNER.email, BUSINESS_OWNER.phone, ownerId],
    )
  } else {
    await query(
      `UPDATE business_claims
       SET status = 'approved',
           email_verified = TRUE,
           contact_status = 'verified',
           ownership_status = 'verified',
           identity_status = 'verified',
           user_id = $2,
           reviewed_at = COALESCE(reviewed_at, NOW()),
           updated_at = NOW()
       WHERE id = $1`,
      [claimExists.rows[0].id, ownerId],
    )
  }

  await upsertReview({
    businessId,
    userId: customerId,
    ...APPLE_REVIEW,
    createdAt: new Date('2026-08-18T10:00:00Z'),
  })

  for (const extra of EXTRA_REVIEWS) {
    const extraId = await ensureUser({
      email: extra.email,
      name: extra.name,
      role: 'customer',
      passwordHash,
    })
    await upsertReview({
      businessId,
      userId: extraId,
      rating: extra.rating,
      title: extra.title,
      content: extra.content,
      reply: extra.reply,
    })
  }

  await query(
    `UPDATE businesses SET
      average_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE business_id = $1 AND status = 'published'), 0),
      review_count = (SELECT COUNT(*) FROM reviews WHERE business_id = $1 AND status = 'published'),
      trust_score = LEAST(100, GREATEST(0,
        COALESCE((SELECT ROUND(AVG(rating)::numeric * 20, 2) FROM reviews WHERE business_id = $1 AND status = 'published'), 0)
      )),
      updated_at = NOW()
     WHERE id = $1`,
    [businessId],
  )

  const stats = await query(
    `SELECT name, slug, claimed, verified_contact, verified_identity, verified_ownership, average_rating, review_count
     FROM businesses WHERE id = $1`,
    [businessId],
  )

  console.log(JSON.stringify({ ok: true, business: stats.rows[0] }, null, 2))
  await pool.end()
}

seed().catch(async (err) => {
  console.error('Seed failed:', err.message)
  await pool.end().catch(() => {})
  process.exit(1)
})
