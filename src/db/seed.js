import bcrypt from 'bcryptjs'
import { pool, query } from './pool.js'
import { env } from '../config/env.js'
import { slugify } from '../utils/helpers.js'
import { categoryService } from '../services/category.service.js'

async function seed() {
  if (env.NODE_ENV === 'production' && process.env.ALLOW_SEED !== 'true') {
    console.error('Refusing to seed in production. Set ALLOW_SEED=true if you really need it.')
    process.exit(1)
  }

  console.log('Seeding database...')

  const categorySeed = await categoryService.seedDefaultCategories()
  if (categorySeed.mainsCreated > 0 || categorySeed.subsCreated > 0) {
    console.log(
      `Categories seeded: ${categorySeed.mainsCreated} main, ${categorySeed.subsCreated} subcategories`,
    )
  }

  // Migrate legacy admin@ email to configured super admin email
  const legacyAdmin = await query(
    `SELECT id FROM users WHERE email = 'admin@checkareview.com' AND email <> $1`,
    [env.ADMIN_EMAIL],
  )
  if (legacyAdmin.rows.length > 0) {
    const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12)
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`)
    await query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('customer', 'business', 'admin', 'super_admin', 'viewer'))
    `)
    const taken = await query(
      `SELECT id FROM users WHERE email = $1 AND role IN ('super_admin', 'admin', 'viewer')`,
      [env.ADMIN_EMAIL],
    )
    if (taken.rows.length === 0) {
      await query(
        `UPDATE users
         SET email = $1, name = 'Super Admin', role = 'super_admin', password_hash = $2, updated_at = NOW()
         WHERE email = 'admin@checkareview.com'`,
        [env.ADMIN_EMAIL, passwordHash],
      )
      console.log(`Legacy admin migrated to super admin: ${env.ADMIN_EMAIL}`)
    }
  }

  const adminExists = await query(
    `SELECT id, role FROM users
     WHERE email = $1 AND role IN ('super_admin', 'admin', 'viewer')
     LIMIT 1`,
    [env.ADMIN_EMAIL],
  )
  if (adminExists.rows.length === 0) {
    const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12)
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`)
    await query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('customer', 'business', 'admin', 'super_admin', 'viewer'))
    `)
    await query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, 'Super Admin', 'super_admin', TRUE)`,
      [env.ADMIN_EMAIL, passwordHash],
    )
    console.log(`Super admin created: ${env.ADMIN_EMAIL}`)
  } else if (adminExists.rows[0].role === 'admin') {
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`)
    await query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('customer', 'business', 'admin', 'super_admin', 'viewer'))
    `)
    await query(
      `UPDATE users SET role = 'super_admin', name = 'Super Admin', updated_at = NOW()
       WHERE email = $1`,
      [env.ADMIN_EMAIL],
    )
    console.log(`Existing admin promoted to super_admin: ${env.ADMIN_EMAIL}`)
  } else {
    await query(
      `UPDATE users SET name = 'Super Admin', role = 'super_admin', updated_at = NOW()
       WHERE email = $1 AND role = 'super_admin'`,
      [env.ADMIN_EMAIL],
    )
  }

  const sampleBusinesses = [
    {
      name: 'Northside Bakery',
      category: 'Bakeries',
      description: 'Dummy business on the Free plan for CRM and portal testing.',
      plan: 'free',
      email: 'free-plan@example.com',
      website: 'https://free-plan-bakery.example.com',
      domains: ['free-plan-bakery.example.com'],
      rating: 4.2,
      reviews: 6,
      trustScore: 78,
    },
    {
      name: 'Oak Street Studio',
      category: 'Photography',
      description: 'Dummy business on the Starter plan for checkout and limits testing.',
      plan: 'starter',
      email: 'starter-plan@example.com',
      website: 'https://starter-plan-studio.example.com',
      domains: ['starter-plan-studio.example.com'],
      rating: 4.5,
      reviews: 18,
      trustScore: 88,
    },
    {
      name: 'Harbor & Co',
      category: 'Clothing & Fashion',
      description: 'Dummy business on the Plus plan for domains, widgets, and brand testing.',
      plan: 'plus',
      email: 'plus-plan@example.com',
      website: 'https://plus-plan-retail.example.com',
      domains: [
        'plus-plan-retail.example.com',
        'shop.plus-plan-retail.example.com',
        'offers.plus-plan-retail.example.com',
      ],
      rating: 4.7,
      reviews: 43,
      trustScore: 92,
    },
    {
      name: 'Riverside Dental',
      category: 'Dental Services',
      description: 'Dummy business on the Premium plan for advanced analytics and premium widgets.',
      plan: 'premium',
      email: 'premium-plan@example.com',
      website: 'https://premium-plan-clinic.example.com',
      domains: [
        'premium-plan-clinic.example.com',
        'locations.premium-plan-clinic.example.com',
        'book.premium-plan-clinic.example.com',
      ],
      rating: 4.8,
      reviews: 96,
      trustScore: 95,
    },
    {
      name: 'Atlas Group',
      category: 'Business Services',
      description: 'Dummy business on the Enterprise plan for full feature and unlimited-plan testing.',
      plan: 'enterprise',
      email: 'enterprise-plan@example.com',
      website: 'https://enterprise-plan-group.example.com',
      domains: [
        'enterprise-plan-group.example.com',
        'uk.enterprise-plan-group.example.com',
        'eu.enterprise-plan-group.example.com',
        'global.enterprise-plan-group.example.com',
      ],
      rating: 4.9,
      reviews: 180,
      trustScore: 98,
    },
  ]

  for (const biz of sampleBusinesses) {
    const slug = slugify(biz.name)
    const passwordHash = await bcrypt.hash('Business@123', 12)

    let userId = null
    const existingUser = await query('SELECT id FROM users WHERE email = $1 AND role = $2', [biz.email, 'business'])
    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id
      await query(
        `UPDATE users
         SET name = $1, email_verified = TRUE, updated_at = NOW()
         WHERE id = $2`,
        [biz.name, userId],
      )
    } else {
      const userResult = await query(
        `INSERT INTO users (email, password_hash, name, role, email_verified)
         VALUES ($1, $2, $3, 'business', TRUE)
         RETURNING id`,
        [biz.email, passwordHash, biz.name],
      )
      userId = userResult.rows[0].id
    }

    let businessId = null
    const existingBusiness = await query(
      `SELECT id FROM businesses
       WHERE email = $1 OR slug = $2 OR user_id = $3
       ORDER BY updated_at DESC
       LIMIT 1`,
      [biz.email, slug, userId],
    )
    if (existingBusiness.rows.length > 0) {
      businessId = existingBusiness.rows[0].id
      await query(
        `UPDATE businesses
         SET user_id = $1,
             name = $2,
             slug = $3,
             category = $4,
             description = $5,
             website = $6,
             email = $7,
             status = 'published',
             average_rating = $8,
             review_count = $9,
             trust_score = $10,
             updated_at = NOW()
         WHERE id = $11`,
        [userId, biz.name, slug, biz.category, biz.description, biz.website, biz.email, biz.rating, biz.reviews, biz.trustScore, businessId],
      )
    } else {
      const bizResult = await query(
        `INSERT INTO businesses (
           user_id, name, slug, category, description, website, email, status, average_rating, review_count, trust_score
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'published', $8, $9, $10)
         RETURNING id`,
        [userId, biz.name, slug, biz.category, biz.description, biz.website, biz.email, biz.rating, biz.reviews, biz.trustScore],
      )
      businessId = bizResult.rows[0].id
    }

    await query(
      `INSERT INTO subscriptions (business_id, plan, status)
       VALUES ($1, $2, 'active')
       ON CONFLICT (business_id) DO UPDATE
         SET plan = EXCLUDED.plan,
             status = 'active',
             updated_at = NOW()`,
      [businessId, biz.plan],
    )

    for (const [index, domain] of biz.domains.entries()) {
      await query(
        `INSERT INTO business_domains (business_id, domain, is_primary, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (business_id, domain) DO UPDATE
           SET is_primary = EXCLUDED.is_primary,
               status = 'active',
               updated_at = NOW()`,
        [businessId, domain, index === 0],
      )
    }

    console.log(`Plan business seeded: ${biz.name} (${biz.plan})`)
  }

  const customerExists = await query(
    `SELECT id FROM users WHERE email = $1 AND role = 'customer'`,
    ['customer@example.com'],
  )
  if (customerExists.rows.length === 0) {
    const passwordHash = await bcrypt.hash('Customer@123', 12)
    await query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ('customer@example.com', $1, 'John Doe', 'customer', TRUE)`,
      [passwordHash],
    )
    console.log('Sample customer created: customer@example.com')
  }

  console.log('Seed completed.')
  await pool.end()
}

seed().catch((err) => {
  console.error('Seed failed:', err.message)
  process.exit(1)
})
