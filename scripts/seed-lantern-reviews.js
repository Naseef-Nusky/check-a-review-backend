/**
 * Seed Lantern Investigations reviews + verified customer accounts.
 *
 * Usage: node scripts/seed-lantern-reviews.js
 *
 * All reviewer logins use role=customer, email_verified=true,
 * password: Reviewer@123
 */
import bcrypt from 'bcryptjs'
import { query } from '../src/db/pool.js'

const BUSINESS_ID = '427b7a14-260d-4f3b-a053-50b753b683ac'
const SHARED_PASSWORD = 'Reviewer@123'

const REVIEWS = [
  {
    name: 'Oliver Bennett',
    email: 'oliver@gmail.com',
    rating: 5,
    date: '2023-02-14',
    title: 'Professional and discreet tracing',
    content:
      'Very professional and discreet. I needed help tracing someone I had not spoken to for years and the team were excellent throughout.',
  },
  {
    name: 'Aisha Rahman',
    email: 'rahman27@gmail.com',
    rating: 5,
    date: '2023-05-22',
    title: 'Calm and discreet advice',
    content:
      'I contacted Lantern because I had concerns about my husband and wanted to understand what my options were. The person I spoke with was calm, helpful and explained everything clearly. The whole matter was handled very discreetly.',
  },
  {
    name: 'James Whitmore',
    email: 'james.whitmore@gmail.com',
    rating: 5,
    date: '2023-08-17',
    title: 'Strong corporate investigation',
    content:
      'Used them for a corporate investigation. Good communication, professional service and a detailed report.',
  },
  {
    name: 'Priya Patel',
    email: 'patel84@gmail.com',
    rating: 5,
    date: '2023-11-06',
    title: 'Helped locate a family member',
    content:
      'I needed assistance locating a family member after losing contact for several years. I only had limited information but Lantern were still able to help and kept me updated throughout.',
  },
  {
    name: 'Daniel Hughes',
    email: 'daniel@gmail.com',
    rating: 5,
    date: '2024-01-19',
    title: 'Straightforward and confidential',
    content: 'Straightforward, professional and confidential. Exactly what I needed.',
  },
  {
    name: 'Elena Petrova',
    email: 'elena.petrova19@gmail.com',
    rating: 5,
    date: '2024-03-28',
    title: 'Clear surveillance report',
    content:
      'I had become suspicious about my partner after several changes in his routine. I spoke to Lantern and they arranged surveillance around the times that concerned me most. Everything was handled very professionally and the report gave me the clarity I needed.',
  },
  {
    name: 'Mohammed Khan',
    email: 'khan@gmail.com',
    rating: 5,
    date: '2024-06-12',
    title: 'Helpful and responsive',
    content: 'Very helpful team. Quick replies and easy to deal with.',
  },
  {
    name: 'Charlotte Spencer',
    email: 'charlotte.spencer52@gmail.com',
    rating: 5,
    date: '2024-09-03',
    title: 'Sensitive workplace matter handled well',
    content:
      'We used Lantern Investigations for a sensitive matter involving an employee. The team understood the need for confidentiality and handled the investigation extremely professionally.',
  },
  {
    name: 'Lucas Ferreira',
    email: 'lucas@gmail.com',
    rating: 5,
    date: '2024-11-21',
    title: 'Clear process for financial tracing',
    content:
      'I needed help tracing someone connected to a financial matter. Communication was very good and the process was explained clearly.',
  },
  {
    name: 'Emily Fletcher',
    email: 'fletcher31@gmail.com',
    rating: 5,
    date: '2024-12-16',
    title: 'Made a nervous first enquiry easy',
    content:
      'I had never contacted a private investigator before and was quite nervous about it. The person I spoke with was very understanding and made the process feel straightforward.',
  },
  {
    name: 'Raj Singh',
    email: 'raj.singh@gmail.com',
    rating: 5,
    date: '2025-02-11',
    title: 'Thorough business background check',
    content:
      'Lantern carried out a background investigation for our business. The report was thorough and provided information we had not been able to obtain ourselves.',
  },
  {
    name: 'Sophie Harrington',
    email: 'sophie76@gmail.com',
    rating: 5,
    date: '2025-04-24',
    title: 'Discreet and professional',
    content: 'Discreet and professional service. I was kept informed throughout.',
  },
  {
    name: 'Marco Rossi',
    email: 'rossi@gmail.com',
    rating: 5,
    date: '2025-06-18',
    title: 'Professional surveillance and report',
    content:
      'I suspected my partner was meeting somebody else but I did not want to confront her without knowing the facts. Lantern helped arrange surveillance and provided a clear written report afterwards. Very professional throughout.',
  },
  {
    name: 'Rebecca Coleman',
    email: 'rebecca.coleman14@gmail.com',
    rating: 5,
    date: '2025-08-07',
    title: 'Responsive and reliable',
    content: 'Good service and very responsive whenever I had a question.',
  },
  {
    name: 'Ahmed El-Sayed',
    email: 'ahmed@gmail.com',
    rating: 5,
    date: '2025-10-29',
    title: 'Discreet corporate enquiry',
    content:
      'Our company had concerns regarding a former member of staff and possible business activity involving our clients. Lantern handled the matter discreetly and provided useful information that helped us decide what to do next.',
  },
  {
    name: 'Sarah McKenzie',
    email: 'mckenzie63@gmail.com',
    rating: 5,
    date: '2025-12-05',
    title: 'Help locating a relative',
    content:
      'I was trying to locate a relative who had moved many years ago. I had an old address and date of birth but very little else. The team were helpful and kept me updated.',
  },
  {
    name: 'Andrei Popescu',
    email: 'andrei.popescu@gmail.com',
    rating: 5,
    date: '2026-01-23',
    title: 'Detailed investigation report',
    content: 'Professional company and a detailed investigation report. Would use again if required.',
  },
  {
    name: 'Lucy Edwards',
    email: 'lucy28@gmail.com',
    rating: 5,
    date: '2026-03-14',
    title: 'Sensitive and private support',
    content:
      'I had been worried for a few months that my partner was not being honest with me. Lantern listened to the situation and explained the options without any pressure. The investigation was handled sensitively and privately.',
  },
  {
    name: 'Kwame Mensah',
    email: 'mensah@gmail.com',
    rating: 5,
    date: '2026-05-09',
    title: 'Thorough corporate due diligence',
    content:
      'We instructed Lantern for corporate due diligence before entering into a new business arrangement. Very thorough work and good communication throughout.',
  },
  {
    name: 'Natalia Kowalska',
    email: 'natalia.kowalska45@gmail.com',
    rating: 5,
    date: '2026-08-18',
    title: 'Approachable and clear throughout',
    content:
      'I needed help finding someone connected to a family matter and wasn’t sure whether the information I had would be enough. The team were approachable, professional and explained everything clearly. I was very pleased with the service.',
  },
]

async function upsertCustomer({ name, email, passwordHash }) {
  const emailLower = email.toLowerCase()
  const existing = await query(
    `SELECT id FROM users WHERE email = $1 AND role = 'customer'`,
    [emailLower],
  )
  if (existing.rows[0]) {
    await query(
      `UPDATE users
       SET name = $1,
           password_hash = $2,
           email_verified = TRUE,
           updated_at = NOW()
       WHERE id = $3`,
      [name, passwordHash, existing.rows[0].id],
    )
    return existing.rows[0].id
  }

  const created = await query(
    `INSERT INTO users (email, password_hash, name, role, email_verified)
     VALUES ($1, $2, $3, 'customer', TRUE)
     RETURNING id`,
    [emailLower, passwordHash, name],
  )
  return created.rows[0].id
}

async function main() {
  const biz = await query(`SELECT id, name FROM businesses WHERE id = $1`, [BUSINESS_ID])
  if (!biz.rows[0]) {
    throw new Error('Lantern Investigations business not found')
  }
  console.log('Seeding reviews for:', biz.rows[0].name)

  const passwordHash = await bcrypt.hash(SHARED_PASSWORD, 12)
  let createdUsers = 0
  let createdReviews = 0
  let updatedReviews = 0

  for (const item of REVIEWS) {
    const userId = await upsertCustomer({
      name: item.name,
      email: item.email,
      passwordHash,
    })
    createdUsers += 1

    const existingReview = await query(
      `SELECT id FROM reviews WHERE business_id = $1 AND user_id = $2`,
      [BUSINESS_ID, userId],
    )

    if (existingReview.rows[0]) {
      await query(
        `UPDATE reviews
         SET rating = $1,
             title = $2,
             content = $3,
             status = 'published',
             created_at = $4::timestamptz,
             updated_at = NOW()
         WHERE id = $5`,
        [item.rating, item.title, item.content, `${item.date}T12:00:00Z`, existingReview.rows[0].id],
      )
      updatedReviews += 1
    } else {
      await query(
        `INSERT INTO reviews
          (business_id, user_id, rating, title, content, status, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, $5, 'published', $6::timestamptz, $6::timestamptz)`,
        [BUSINESS_ID, userId, item.rating, item.title, item.content, `${item.date}T12:00:00Z`],
      )
      createdReviews += 1
    }
  }

  await query(
    `UPDATE businesses SET
      average_rating = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 2)
        FROM reviews WHERE business_id = $1 AND status = 'published'
      ), 0),
      review_count = (
        SELECT COUNT(*) FROM reviews WHERE business_id = $1 AND status = 'published'
      ),
      trust_score = LEAST(100, GREATEST(0, COALESCE((
        SELECT ROUND(AVG(rating)::numeric * 20, 2)
        FROM reviews WHERE business_id = $1 AND status = 'published'
      ), 0))),
      ai_review_summary = NULL,
      updated_at = NOW()
     WHERE id = $1`,
    [BUSINESS_ID],
  )

  const stats = await query(
    `SELECT average_rating, review_count, trust_score FROM businesses WHERE id = $1`,
    [BUSINESS_ID],
  )

  console.log('Users ready:', createdUsers)
  console.log('Reviews inserted:', createdReviews)
  console.log('Reviews updated:', updatedReviews)
  console.log('Business stats:', stats.rows[0])
  console.log('Shared reviewer password:', SHARED_PASSWORD)
  console.log('All accounts are role=customer and email_verified=true')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
