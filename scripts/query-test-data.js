import { pool, query } from '../src/db/pool.js'

const businesses = await query(`
  SELECT b.id, b.name, b.slug, b.email, b.category, b.website, b.status, s.plan
  FROM businesses b
  LEFT JOIN subscriptions s ON s.business_id = b.id
  WHERE b.email LIKE '%@example.com'
  ORDER BY b.name
`)

const users = await query(`
  SELECT email, name, role FROM users
  WHERE email LIKE '%@example.com' OR email LIKE '%@checkareview.com'
  ORDER BY role, email
`)

const reviews = await query(`
  SELECT r.id, b.name AS business, b.slug, u.email AS reviewer, r.rating, r.title, r.status,
    CASE WHEN r.business_reply IS NOT NULL THEN 'yes' ELSE 'no' END AS has_reply,
    LEFT(r.business_reply, 80) AS reply_preview
  FROM reviews r
  JOIN businesses b ON b.id = r.business_id
  JOIN users u ON u.id = r.user_id
  ORDER BY b.name
`)

console.log(JSON.stringify({ businesses: businesses.rows, users: users.rows, reviews: reviews.rows }, null, 2))
await pool.end()
