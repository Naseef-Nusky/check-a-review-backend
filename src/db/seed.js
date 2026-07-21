import bcrypt from 'bcryptjs'
import { pool, query } from './pool.js'
import { env } from '../config/env.js'
import { slugify } from '../utils/helpers.js'
import { categoryService } from '../services/category.service.js'

async function seed() {
  console.log('Seeding database...')

  const categorySeed = await categoryService.seedDefaultCategories()
  if (categorySeed.mainsCreated > 0 || categorySeed.subsCreated > 0) {
    console.log(
      `Categories seeded: ${categorySeed.mainsCreated} main, ${categorySeed.subsCreated} subcategories`,
    )
  }

  const adminExists = await query('SELECT id FROM users WHERE email = $1', [env.ADMIN_EMAIL])
  if (adminExists.rows.length === 0) {
    const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 12)
    await query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, 'Admin', 'admin', TRUE)`,
      [env.ADMIN_EMAIL, passwordHash],
    )
    console.log(`Admin created: ${env.ADMIN_EMAIL}`)
  }

  const sampleBusinesses = [
    { name: 'Tech Solutions Inc', category: 'Internet & Software', description: 'Leading technology solutions provider.' },
    { name: 'Green Cafe', category: 'Coffee & Tea', description: 'Organic coffee and healthy meals.' },
    { name: 'FitLife Gym', category: 'Wellness & Spa', description: 'Premium fitness center with personal training.' },
  ]

  for (const biz of sampleBusinesses) {
    const exists = await query('SELECT id FROM businesses WHERE slug = $1', [slugify(biz.name)])
    if (exists.rows.length > 0) continue

    const email = `${slugify(biz.name)}@example.com`
    const passwordHash = await bcrypt.hash('Business@123', 12)

    const userResult = await query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'business', TRUE) RETURNING id`,
      [email, passwordHash, biz.name],
    )

    const bizResult = await query(
      `INSERT INTO businesses (user_id, name, slug, category, description, email, average_rating, review_count, trust_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [userResult.rows[0].id, biz.name, slugify(biz.name), biz.category, biz.description, email, 4.5, 10, 90],
    )

    await query(`INSERT INTO subscriptions (business_id, plan) VALUES ($1, 'starter')`, [bizResult.rows[0].id])
    console.log(`Business seeded: ${biz.name}`)
  }

  const customerExists = await query('SELECT id FROM users WHERE email = $1', ['customer@example.com'])
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
