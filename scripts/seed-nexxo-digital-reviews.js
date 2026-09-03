/**
 * Seed Nexxo Digital reviews + verified customer accounts.
 *
 * This converts your old SQL-style rows into the current schema:
 * - reviews: { business_id, user_id, rating, title, content, status, created_at }
 * - users: upsert by (email, role='customer')
 *
 * Run:
 *   node scripts/seed-nexxo-digital-reviews.js
 *
 * Before running, set:
 *   - BUSINESS_ID (Nexxo business uuid)
 *   - REVIEW_STATUS ('published' or 'pending')
 */
import bcrypt from 'bcryptjs'
import { query } from '../src/db/pool.js'

// TODO: replace with Nexxo business UUID
const BUSINESS_ID = '05b6e57c-ddf9-41a5-9d87-89b5970a9e79'

// If you want these visible publicly, use 'published'.
// If you want them hidden until moderation/approval, use 'pending'.
const REVIEW_STATUS = 'published'

const SHARED_PASSWORD = 'Reviewer@123'

const REVIEWS = [
  {
    name: 'James Whitmore',
    email: 'james@gmail.com',
    rating: 5,
    date: '2025-01-18',
    content:
      'Really pleased with the new website. The whole process was straightforward and the finished site looks much more professional than what we had before.',
  },
  {
    name: 'Sophie Bennett',
    email: 'bennett27@gmail.com',
    rating: 5,
    date: '2025-02-27',
    content:
      'Nexxo Digital rebuilt our website and made a huge improvement. Communication was good throughout and they understood exactly what we were trying to achieve.',
  },
  {
    name: 'Arjun Mehta',
    email: 'arjun.mehta@gmail.com',
    rating: 5,
    date: '2025-04-16',
    content:
      'We approached Nexxo for help with Google Ads after wasting quite a bit of money with another company. The campaigns are now much more focused and we are getting better quality enquiries. Very happy so far.',
  },
  {
    name: 'Daniel Foster',
    email: 'foster@gmail.com',
    rating: 5,
    date: '2025-06-08',
    content:
      'Great service and very responsive. Website was completed on time and looks excellent.',
  },
  {
    name: 'Priya Shah',
    email: 'priya84@gmail.com',
    rating: 5,
    date: '2025-07-29',
    content:
      'We used Nexxo Digital for SEO and website improvements. They explained everything clearly without making it overly technical. We’ve already started seeing improvements in our Google visibility.',
  },
  {
    name: 'Mohammed Rahman',
    email: 'mohammed.rahman@gmail.com',
    rating: 5,
    date: '2025-09-21',
    content:
      'Excellent experience from start to finish. They redesigned our company website, improved the mobile version and helped us set up our PPC campaigns. The difference in the quality of enquiries has been noticeable.',
  },
  {
    name: 'Emily Cartwright',
    email: 'cartwright@gmail.com',
    rating: 5,
    date: '2025-10-14',
    content:
      'Professional team and easy to work with. Would definitely recommend Nexxo for web design.',
  },
  {
    name: 'Luca Romano',
    email: 'luca.romano31@gmail.com',
    rating: 5,
    date: '2025-12-05',
    content:
      'Our old website had become very dated and slow. Nexxo created a completely new site that is faster, cleaner and much easier for customers to use. They also helped with the SEO structure which was something we hadn’t really considered before.',
  },
  {
    name: 'Charlotte Hughes',
    email: 'charlotte@gmail.com',
    rating: 5,
    date: '2026-01-23',
    content:
      'Very happy with our new website. They listened to our ideas but also gave useful advice where they thought something could be improved.',
  },
  {
    name: 'Ahmed Khan',
    email: 'khan52@gmail.com',
    rating: 5,
    date: '2026-03-11',
    content:
      'Nexxo Digital currently manages our Google Ads. We’ve had a much better experience compared with our previous agency. Reporting is clear and we’re actually getting enquiries relevant to the services we provide.',
  },
  {
    name: 'Thomas Reed',
    email: 'thomas@gmail.com',
    rating: 5,
    date: '2026-04-28',
    content:
      'Good company. Quick communication and the website came out exactly how we wanted.',
  },
  {
    name: 'Isabella Rossi',
    email: 'rossi@gmail.com',
    rating: 5,
    date: '2026-06-17',
    content:
      'We needed a professional website for a new business and Nexxo handled everything for us. The design is modern and we’ve had lots of positive comments from customers.',
  },
  {
    name: 'Oliver Grant',
    email: 'oliver.grant46@gmail.com',
    rating: 5,
    date: '2026-07-26',
    content:
      'Used Nexxo for both web design and PPC. Very impressed with the attention to detail. They didn’t just build the website and disappear, they helped us improve the landing pages and advertising afterwards as well.',
  },
  {
    name: 'Anika Patel',
    email: 'patel@gmail.com',
    rating: 5,
    date: '2026-08-04',
    content:
      'Really helpful team. They improved our SEO and sorted out several issues on our website that were stopping pages ranking properly.',
  },
  {
    name: 'George Harrison',
    email: 'george@gmail.com',
    rating: 5,
    date: '2026-09-03',
    content:
      'The new website is a massive improvement. Loads quicker, looks better and is much easier to navigate.',
  },
  {
    name: 'Sara Kowalska',
    email: 'kowalska73@gmail.com',
    rating: 5,
    date: '2025-03-12',
    content:
      'We were looking for an agency that could handle the website, SEO and Google Ads rather than dealing with three different companies. Nexxo has been great. Everything feels much more joined up now and we’ve seen a steady increase in enquiries.',
  },
  {
    name: 'Benjamin Clarke',
    email: 'benjamin.clarke@gmail.com',
    rating: 5,
    date: '2025-05-24',
    content:
      'Very knowledgeable with Google Ads. They restructured our campaign and cut out a lot of irrelevant traffic. Definitely seeing better leads now.',
  },
  {
    name: 'Fatima Ali',
    email: 'ali@gmail.com',
    rating: 5,
    date: '2025-08-17',
    content:
      'Fantastic service. Our new website looks clean and professional and works perfectly on mobile. Communication was excellent throughout the project.',
  },
  {
    name: 'Henry Collins',
    email: 'henry.collins28@gmail.com',
    rating: 5,
    date: '2025-11-19',
    content:
      'Nexxo redesigned our website after we’d been putting it off for years. They made the process surprisingly easy and delivered a site we’re genuinely proud to send customers to.',
  },
  {
    name: 'Nadia Petrova',
    email: 'nadia@gmail.com',
    rating: 5,
    date: '2026-02-09',
    content:
      'We’ve been working with Nexxo Digital on SEO for several months. They have been transparent about what they are doing and we are now appearing higher for a number of important searches. Very pleased with the progress.',
  },
  {
    name: 'Adam Richardson',
    email: 'richardson@gmail.com',
    rating: 5,
    date: '2026-05-06',
    content:
      'Fast, professional and reasonably priced. Would use them again.',
  },
  {
    name: 'Elena Garcia',
    email: 'elena.garcia64@gmail.com',
    rating: 5,
    date: '2025-04-02',
    content:
      'Our Google Ads were generating clicks but very few actual enquiries. Nexxo reviewed everything, created new ads and landing pages and the quality of leads has improved considerably. Communication has also been excellent.',
  },
  {
    name: 'Joshua Taylor',
    email: 'joshua@gmail.com',
    rating: 5,
    date: '2025-10-29',
    content:
      'Really impressed with the website they built for us. Modern design, quick turnaround and nothing seemed like too much trouble when we requested changes.',
  },
  {
    name: 'Hassan Mahmood',
    email: 'mahmood35@gmail.com',
    rating: 5,
    date: '2026-01-05',
    content:
      'We’ve used Nexxo for website development, SEO and PPC. The biggest thing for us has been having one company responsible for the whole online marketing side of the business. We’ve seen more enquiries coming through and the website looks far more professional.',
  },
  {
    name: 'Rebecca Morgan',
    email: 'rebecca.morgan@gmail.com',
    rating: 5,
    date: '2026-04-09',
    content:
      'Very good experience. Clear communication, good ideas and they delivered what they promised.',
  },
  {
    name: 'Dimitri Georgiou',
    email: 'georgiou82@gmail.com',
    rating: 5,
    date: '2026-08-22',
    content:
      'Nexxo Digital helped us completely overhaul our online presence. The old website wasn’t generating much business and our Google Ads were poorly organised. They built a new conversion-focused website, reorganised the advertising and started working on our SEO. We now have a much stronger foundation and are receiving noticeably more relevant enquiries. I would happily recommend them.',
  },
]

function toTitleFromContent(content) {
  // Give reviews a non-empty title (schema requires it).
  // Keep it stable/deterministic: first ~9 words (or full string if shorter).
  const text = String(content || '').trim()
  if (!text) return 'Customer review'
  const words = text.split(/\s+/).slice(0, 9).join(' ')
  return words.length > 80 ? `${words.slice(0, 77)}...` : words
}

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
  if (BUSINESS_ID === 'NEXXO_BUSINESS_ID') {
    throw new Error('Please replace BUSINESS_ID with Nexxo business UUID')
  }

  const biz = await query(`SELECT id, name FROM businesses WHERE id = $1`, [BUSINESS_ID])
  if (!biz.rows[0]) throw new Error('Nexxo business not found')
  console.log('Seeding reviews for:', biz.rows[0].name)

  const passwordHash = await bcrypt.hash(SHARED_PASSWORD, 12)

  let createdUsers = 0
  let createdReviews = 0
  let updatedReviews = 0

  // Ensure created_at order is correct regardless of insert loop order.
  const ordered = [...REVIEWS].sort((a, b) => new Date(a.date) - new Date(b.date))

  for (const item of ordered) {
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

    const title = toTitleFromContent(item.content)
    const createdAt = `${item.date}T12:00:00Z`

    if (existingReview.rows[0]) {
      await query(
        `UPDATE reviews
         SET rating = $1,
             title = $2,
             content = $3,
             status = $4,
             created_at = $5::timestamptz,
             updated_at = NOW()
         WHERE id = $6`,
        [item.rating, title, item.content, REVIEW_STATUS, createdAt, existingReview.rows[0].id],
      )
      updatedReviews += 1
    } else {
      await query(
        `INSERT INTO reviews
          (business_id, user_id, rating, title, content, status, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, $7::timestamptz, NOW())`,
        [BUSINESS_ID, userId, item.rating, title, item.content, REVIEW_STATUS, createdAt],
      )
      createdReviews += 1
    }
  }

  // Recompute business stats for published reviews.
  await query(
    `UPDATE businesses SET
      average_rating = COALESCE((
        SELECT ROUND(AVG(rating)::numeric, 2)
        FROM reviews WHERE business_id = $1 AND status = 'published'
      ), 0),
      review_count = (
        SELECT COUNT(*)
        FROM reviews WHERE business_id = $1 AND status = 'published'
      ),
      trust_score = LEAST(100, GREATEST(0, COALESCE((
        SELECT ROUND(AVG(rating)::numeric * 20, 2) FROM reviews WHERE business_id = $1 AND status = 'published'
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

  console.log('Users processed:', createdUsers)
  console.log('Reviews inserted:', createdReviews)
  console.log('Reviews updated:', updatedReviews)
  console.log('Business stats:', stats.rows[0])
  console.log(`Shared reviewer password: ${SHARED_PASSWORD}`)
  console.log(`Review status: ${REVIEW_STATUS}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })

