/**
 * Move "Imported Categories" (and leftover WP parent mains) into proper CRM mains.
 *
 * Usage: node scripts/reclassify-imported-categories.js
 */
import { query } from '../src/db/pool.js'

const RULES = [
  {
    main: 'Animals & Pets',
    keywords: ['pet', 'vet', 'aquarium', 'animal', 'dog', 'cat', 'veterinary'],
  },
  {
    main: 'Beauty & Well-being',
    keywords: [
      'beauty',
      'spa',
      'barber',
      'hair',
      'massage',
      'sunbed',
      'salon',
      'well-being',
      'wellbeing',
      'fitness and nutrition',
      'health and fitness',
      'gym',
    ],
  },
  {
    main: 'Business Services',
    keywords: [
      'digital marketing',
      'marketing',
      'office supply',
      'business to business',
      'b2b',
      'online services',
      'online',
      'quotes',
      'model agency',
      'ai company',
      'ai companys',
      'ai services',
      'a i company',
      'a i companys',
      'a i services',
      'services',
    ],
  },
  {
    main: 'Construction & Manufacturing',
    keywords: [
      'builder',
      'building',
      'construction',
      'scaffolding',
      'roofing',
      'plasterer',
      'tiler',
      'joiner',
      'carpentry',
      'glazing',
      'window',
      'door',
      'electrician',
      'plumber',
      'paving',
      'driveway',
      'floor fitter',
      'carpet fitter',
      'lift repair',
      'solar',
      'property maintenance',
    ],
  },
  {
    main: 'Education & Training',
    keywords: ['school', 'education', 'college', 'training', 'tutor'],
  },
  {
    main: 'Electronics & Technology',
    keywords: ['phone repair', 'computer', 'electronics', 'it ', 'software', 'tech'],
  },
  {
    main: 'Events & Entertainment',
    keywords: [
      'event',
      'party',
      'entertainment',
      'night club',
      'nightclub',
      'dating',
      'venue',
    ],
  },
  {
    main: 'Food, Beverages & Tobacco',
    keywords: [
      'cafe',
      'coffee',
      'tea room',
      'restaurant',
      'take away',
      'takeaway',
      'pub',
      'bar',
      'supermarket',
      'drinks',
      'whiskey',
      'food',
    ],
  },
  {
    main: 'Health & Medical',
    keywords: ['dental', 'dentist', 'optician', 'health & medical', 'medical', 'clinic', 'doctor'],
  },
  {
    main: 'Hobbies & Crafts',
    keywords: [
      'astrolog',
      'horoscope',
      'clairvoyant',
      'fortuneteller',
      'soothsayer',
      'art dealer',
      'art gallery',
      'art investment',
      'arts & entertainment',
    ],
  },
  {
    main: 'Home & Garden',
    keywords: [
      'interior design',
      'diy',
      'gardener',
      'landscaping',
      'tree surgeon',
      'window cleaner',
      'furniture',
    ],
  },
  {
    main: 'Home Services',
    keywords: [
      'cleaning',
      'dry cleaning',
      'locksmith',
      'movers',
      'alarms',
      'cctv',
      'security company',
      'security systems',
      'house',
    ],
  },
  {
    main: 'Legal Services & Government',
    keywords: [
      'lawyer',
      'solicitor',
      'law firm',
      'bailiff',
      'investigation',
      'investigator',
      'private investig',
    ],
  },
  {
    main: 'Media & Publishing',
    keywords: ['photograph', 'media', 'publisher', 'video'],
  },
  {
    main: 'Money & Insurance',
    keywords: [
      'account',
      'finance',
      'banking',
      'bank',
      'debt',
      'crypto',
      'investment',
      'estate agent',
      'land agent',
      'commercial agent',
      'property investment',
      'diamond',
      'gold company',
      'gold investment',
      'wealth recovery',
      'recovery company',
      'money',
      'insurance',
    ],
  },
  {
    main: 'Public & Local Services',
    keywords: ['storage', 'funeral', 'public'],
  },
  {
    main: 'Restaurants & Bars',
    keywords: [], // covered via Food keywords; keep for clarity
  },
  {
    main: 'Shopping & Fashion',
    keywords: [
      'clothing',
      'jeweller',
      'watch trader',
      'department store',
      'shopping',
      'pet shop',
      'pet supplies',
    ],
  },
  {
    main: 'Sports',
    keywords: ['sport', 'leisure', 'fitness', 'gym'],
  },
  {
    main: 'Travel & Vacation',
    keywords: ['airline', 'travel', 'hotel', 'holiday'],
  },
  {
    main: 'Utilities',
    keywords: ['energy supplier', 'energy', 'utility', 'water utility'],
  },
  {
    main: 'Vehicles & Transportation',
    keywords: [
      'automotive',
      'car ',
      'carbody',
      'vehicle',
      'tyre',
      'accident management',
      'breakdown',
      'mechanics',
      'recovery',
    ],
  },
]

function scoreMatch(name, keywords) {
  const hay = ` ${String(name || '').toLowerCase()} `
  let best = 0
  for (const kw of keywords) {
    const needle = String(kw).toLowerCase().trim()
    if (!needle) continue
    if (hay.includes(` ${needle} `) || hay.includes(needle)) {
      best = Math.max(best, needle.length)
    }
  }
  return best
}

function pickMain(name) {
  let bestMain = 'Business Services'
  let bestScore = 0
  for (const rule of RULES) {
    const score = scoreMatch(name, rule.keywords)
    if (score > bestScore) {
      bestScore = score
      bestMain = rule.main
    }
  }
  // Prefer Restaurants & Bars for cafe/restaurant/pub/bar when score ties into Food
  const lower = name.toLowerCase()
  if (
    /(restaurant|cafe|coffee|tea room|pub|take ?away|night club)/i.test(lower) &&
    !/supermarket|drinks supplier|whiskey/i.test(lower)
  ) {
    return 'Restaurants & Bars'
  }
  if (/beauty|spa|barber|hairdresser|massage|sunbed/i.test(lower)) {
    return 'Beauty & Well-being'
  }
  if (/gym|fitness|sport|leisure/i.test(lower) && !/nutrition/i.test(lower)) {
    return 'Sports'
  }
  return bestMain
}

async function ensureMain(name) {
  const existing = await query(
    `SELECT id, name FROM main_categories WHERE LOWER(name) = LOWER($1)`,
    [name],
  )
  if (existing.rows[0]) return existing.rows[0]
  const sort = await query('SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM main_categories')
  const slugBase = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const inserted = await query(
    `INSERT INTO main_categories (name, slug, sort_order)
     VALUES ($1, $2, $3)
     RETURNING id, name`,
    [name, slugBase, sort.rows[0].next],
  )
  return inserted.rows[0]
}

async function main() {
  const sourceMains = await query(`
    SELECT id, name FROM main_categories
    WHERE name IN ('Imported Categories', 'Beauty', 'Dental', 'Glazing', 'Services', 'Well-being')
  `)
  if (sourceMains.rows.length === 0) {
    console.log('No imported/leftover mains found.')
    process.exit(0)
  }

  const sourceIds = sourceMains.rows.map((r) => r.id)
  const subs = await query(
    `SELECT id, name, main_category_id, slug
     FROM sub_categories
     WHERE main_category_id = ANY($1::uuid[])
     ORDER BY name`,
    [sourceIds],
  )

  console.log('Subcategories to reclassify:', subs.rows.length)

  const moved = {}
  let movedCount = 0
  let mergedCount = 0

  for (const sub of subs.rows) {
    const targetMainName = pickMain(sub.name)
    const targetMain = await ensureMain(targetMainName)

    if (targetMain.id === sub.main_category_id) {
      moved[targetMainName] = (moved[targetMainName] || 0) + 1
      continue
    }

    // If same name already exists under target main, merge into it
    const conflict = await query(
      `SELECT id, name FROM sub_categories
       WHERE main_category_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3`,
      [targetMain.id, sub.name, sub.id],
    )

    if (conflict.rows[0]) {
      await query(
        `UPDATE businesses
         SET category = $1, updated_at = NOW()
         WHERE LOWER(TRIM(category)) = LOWER($2)`,
        [conflict.rows[0].name, sub.name],
      )
      await query(`DELETE FROM sub_categories WHERE id = $1`, [sub.id])
      mergedCount += 1
      moved[targetMainName] = (moved[targetMainName] || 0) + 1
      continue
    }

    // Global name unique under another main? Just move this row.
    await query(
      `UPDATE sub_categories
       SET main_category_id = $1
       WHERE id = $2`,
      [targetMain.id, sub.id],
    )
    movedCount += 1
    moved[targetMainName] = (moved[targetMainName] || 0) + 1
  }

  // Remove empty leftover mains (not seed mains)
  const leftovers = ['Imported Categories', 'Beauty', 'Dental', 'Glazing', 'Services', 'Well-being']
  let deletedMains = 0
  for (const name of leftovers) {
    const mainRow = await query(`SELECT id FROM main_categories WHERE name = $1`, [name])
    if (!mainRow.rows[0]) continue
    const remaining = await query(
      `SELECT COUNT(*)::int AS c FROM sub_categories WHERE main_category_id = $1`,
      [mainRow.rows[0].id],
    )
    if (remaining.rows[0].c === 0) {
      await query(`DELETE FROM main_categories WHERE id = $1`, [mainRow.rows[0].id])
      deletedMains += 1
    }
  }

  console.log('\nMoved:', movedCount)
  console.log('Merged duplicates:', mergedCount)
  console.log('Deleted empty leftover mains:', deletedMains)
  console.log('By main:', moved)

  const check = await query(`
    SELECT m.name, COUNT(s.id)::int AS subs
    FROM main_categories m
    LEFT JOIN sub_categories s ON s.main_category_id = m.id
    GROUP BY m.name
    ORDER BY m.name
  `)
  console.log('\nFinal tree counts:')
  for (const row of check.rows) {
    console.log(`- ${row.name}: ${row.subs}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
