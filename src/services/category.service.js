import { query } from '../db/pool.js'
import { AppError, slugify } from '../utils/helpers.js'
import { CATEGORY_SEED } from '../data/categorySeedData.js'

async function ensureCategoryTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS main_categories (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      name VARCHAR(150) UNIQUE NOT NULL,
      slug VARCHAR(180) UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS sub_categories (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      main_category_id UUID NOT NULL REFERENCES main_categories(id) ON DELETE CASCADE,
      name VARCHAR(150) NOT NULL,
      slug VARCHAR(180) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (main_category_id, name),
      UNIQUE (slug)
    )
  `)

  await query(`
    CREATE INDEX IF NOT EXISTS idx_sub_categories_main_category_id
    ON sub_categories(main_category_id)
  `)
}

async function buildCategoryTree() {
  await ensureCategoryTables()

  const mains = await query(
    `SELECT id, name, slug, sort_order, created_at
     FROM main_categories
     ORDER BY sort_order ASC, name ASC`,
  )

  const subs = await query(
    `SELECT s.id, s.main_category_id, s.name, s.slug, s.created_at, m.name AS main_name
     FROM sub_categories s
     JOIN main_categories m ON m.id = s.main_category_id
     ORDER BY s.name ASC`,
  )

  const countsResult = await query(
    `SELECT LOWER(category) AS category_key, COUNT(*)::int AS count
     FROM businesses
     GROUP BY LOWER(category)`,
  )
  const countByCategory = countsResult.rows.reduce((acc, row) => {
    acc[row.category_key] = row.count
    return acc
  }, {})

  const subsByMain = subs.rows.reduce((acc, sub) => {
    if (!acc[sub.main_category_id]) acc[sub.main_category_id] = []
    acc[sub.main_category_id].push(sub)
    return acc
  }, {})

  return mains.rows.map((main) => {
    const subcategories = (subsByMain[main.id] || []).map((sub) => ({
      id: sub.id,
      name: sub.name,
      slug: sub.slug,
      mainCategoryId: sub.main_category_id,
      mainCategoryName: sub.main_name,
      count: countByCategory[sub.name.toLowerCase()] ?? 0,
      createdAt: sub.created_at,
    }))

    const count = subcategories.reduce((sum, sub) => sum + sub.count, 0)

    return {
      id: main.id,
      name: main.name,
      slug: main.slug,
      sortOrder: main.sort_order,
      count,
      subcategories,
      createdAt: main.created_at,
    }
  })
}

export const categoryService = {
  ensureCategoryTables,

  async getCategoryTree() {
    return buildCategoryTree()
  },

  async getFlatSubcategories() {
    const tree = await buildCategoryTree()
    return tree.flatMap((main) =>
      main.subcategories.map((sub) => ({
        ...sub,
        mainCategoryId: main.id,
        mainCategoryName: main.name,
      })),
    )
  },

  async createMainCategory(name) {
    await ensureCategoryTables()
    const trimmed = String(name || '').trim()
    if (!trimmed) throw new AppError('Main category name is required', 400)

    const slug = slugify(trimmed)
    const exists = await query(
      'SELECT id FROM main_categories WHERE LOWER(name) = LOWER($1) OR slug = $2',
      [trimmed, slug],
    )
    if (exists.rows.length > 0) throw new AppError('Main category already exists', 409)

    const sortOrderResult = await query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM main_categories')
    const sortOrder = sortOrderResult.rows[0].next

    const result = await query(
      `INSERT INTO main_categories (name, slug, sort_order)
       VALUES ($1, $2, $3)
       RETURNING id, name, slug, sort_order, created_at`,
      [trimmed, slug, sortOrder],
    )

    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      sortOrder: row.sort_order,
      count: 0,
      subcategories: [],
      createdAt: row.created_at,
    }
  },

  async createSubCategory(mainCategoryId, name) {
    await ensureCategoryTables()
    const trimmed = String(name || '').trim()
    if (!trimmed) throw new AppError('Subcategory name is required', 400)
    if (!mainCategoryId) throw new AppError('Main category is required', 400)

    const main = await query('SELECT id, name FROM main_categories WHERE id = $1', [mainCategoryId])
    if (main.rows.length === 0) throw new AppError('Main category not found', 404)

    const slug = slugify(trimmed)
    const exists = await query(
      `SELECT id FROM sub_categories
       WHERE main_category_id = $1 AND LOWER(name) = LOWER($2)`,
      [mainCategoryId, trimmed],
    )
    if (exists.rows.length > 0) throw new AppError('Subcategory already exists in this main category', 409)

    const slugExists = await query('SELECT id FROM sub_categories WHERE slug = $1', [slug])
    if (slugExists.rows.length > 0) throw new AppError('Subcategory slug already exists', 409)

    const result = await query(
      `INSERT INTO sub_categories (main_category_id, name, slug)
       VALUES ($1, $2, $3)
       RETURNING id, main_category_id, name, slug, created_at`,
      [mainCategoryId, trimmed, slug],
    )

    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      mainCategoryId: row.main_category_id,
      mainCategoryName: main.rows[0].name,
      count: 0,
      createdAt: row.created_at,
    }
  },

  async updateMainCategory(id, name) {
    await ensureCategoryTables()
    const trimmed = String(name || '').trim()
    if (!trimmed) throw new AppError('Main category name is required', 400)
    if (!id) throw new AppError('Main category id is required', 400)

    const existing = await query('SELECT id, name FROM main_categories WHERE id = $1', [id])
    if (existing.rows.length === 0) throw new AppError('Main category not found', 404)

    const slug = slugify(trimmed)
    const conflict = await query(
      `SELECT id FROM main_categories
       WHERE (LOWER(name) = LOWER($1) OR slug = $2) AND id <> $3`,
      [trimmed, slug, id],
    )
    if (conflict.rows.length > 0) throw new AppError('Main category already exists', 409)

    const result = await query(
      `UPDATE main_categories
       SET name = $1, slug = $2
       WHERE id = $3
       RETURNING id, name, slug, sort_order, created_at`,
      [trimmed, slug, id],
    )

    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
    }
  },

  async updateSubCategory(id, { name, mainCategoryId } = {}) {
    await ensureCategoryTables()
    if (!id) throw new AppError('Subcategory id is required', 400)

    const existing = await query(
      `SELECT id, name, slug, main_category_id FROM sub_categories WHERE id = $1`,
      [id],
    )
    if (existing.rows.length === 0) throw new AppError('Subcategory not found', 404)

    const current = existing.rows[0]
    const trimmed = name !== undefined ? String(name || '').trim() : current.name
    if (!trimmed) throw new AppError('Subcategory name is required', 400)

    const nextMainId = mainCategoryId || current.main_category_id
    const main = await query('SELECT id, name FROM main_categories WHERE id = $1', [nextMainId])
    if (main.rows.length === 0) throw new AppError('Main category not found', 404)

    const slug = slugify(trimmed)
    const nameConflict = await query(
      `SELECT id FROM sub_categories
       WHERE main_category_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3`,
      [nextMainId, trimmed, id],
    )
    if (nameConflict.rows.length > 0) {
      throw new AppError('Subcategory already exists in this main category', 409)
    }

    const slugConflict = await query(
      `SELECT id FROM sub_categories WHERE slug = $1 AND id <> $2`,
      [slug, id],
    )
    if (slugConflict.rows.length > 0) throw new AppError('Subcategory slug already exists', 409)

    const result = await query(
      `UPDATE sub_categories
       SET name = $1, slug = $2, main_category_id = $3
       WHERE id = $4
       RETURNING id, main_category_id, name, slug, created_at`,
      [trimmed, slug, nextMainId, id],
    )

    if (current.name !== trimmed) {
      await query(
        `UPDATE businesses
         SET category = $1, updated_at = NOW()
         WHERE LOWER(category) = LOWER($2)`,
        [trimmed, current.name],
      )
    }

    const row = result.rows[0]
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      mainCategoryId: row.main_category_id,
      mainCategoryName: main.rows[0].name,
      createdAt: row.created_at,
    }
  },

  async deleteMainCategory(id) {
    await ensureCategoryTables()
    if (!id) throw new AppError('Main category id is required', 400)

    const existing = await query('SELECT id, name FROM main_categories WHERE id = $1', [id])
    if (existing.rows.length === 0) throw new AppError('Main category not found', 404)

    const subs = await query(
      'SELECT name FROM sub_categories WHERE main_category_id = $1',
      [id],
    )
    const subNames = subs.rows.map((row) => row.name)

    if (subNames.length > 0) {
      const bizCount = await query(
        `SELECT COUNT(*)::int AS count
         FROM businesses
         WHERE LOWER(category) = ANY($1::text[])`,
        [subNames.map((name) => name.toLowerCase())],
      )
      if (bizCount.rows[0].count > 0) {
        throw new AppError(
          'Cannot delete this main category while businesses are assigned to its subcategories. Move or reassign those businesses first.',
          409,
        )
      }
    }

    await query('DELETE FROM main_categories WHERE id = $1', [id])
    return { id, deleted: true }
  },

  async deleteSubCategory(id) {
    await ensureCategoryTables()
    if (!id) throw new AppError('Subcategory id is required', 400)

    const existing = await query('SELECT id, name FROM sub_categories WHERE id = $1', [id])
    if (existing.rows.length === 0) throw new AppError('Subcategory not found', 404)

    const bizCount = await query(
      `SELECT COUNT(*)::int AS count
       FROM businesses
       WHERE LOWER(category) = LOWER($1)`,
      [existing.rows[0].name],
    )
    if (bizCount.rows[0].count > 0) {
      throw new AppError(
        'Cannot delete this subcategory while businesses are assigned to it. Reassign those businesses first.',
        409,
      )
    }

    await query('DELETE FROM sub_categories WHERE id = $1', [id])
    return { id, deleted: true }
  },

  async seedDefaultCategories() {
    await ensureCategoryTables()

    let mainsCreated = 0
    let subsCreated = 0

    for (let i = 0; i < CATEGORY_SEED.length; i += 1) {
      const item = CATEGORY_SEED[i]
      const slug = slugify(item.name)

      let mainId
      const existingMain = await query(
        'SELECT id FROM main_categories WHERE LOWER(name) = LOWER($1) OR slug = $2',
        [item.name, slug],
      )

      if (existingMain.rows.length > 0) {
        mainId = existingMain.rows[0].id
      } else {
        const inserted = await query(
          `INSERT INTO main_categories (name, slug, sort_order)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [item.name, slug, i + 1],
        )
        mainId = inserted.rows[0].id
        mainsCreated += 1
      }

      for (const subName of item.subcategories) {
        const subSlug = slugify(subName)
        const existingSub = await query(
          `SELECT id FROM sub_categories
           WHERE main_category_id = $1 AND LOWER(name) = LOWER($2)`,
          [mainId, subName],
        )

        if (existingSub.rows.length > 0) continue

        const slugTaken = await query('SELECT id FROM sub_categories WHERE slug = $1', [subSlug])
        if (slugTaken.rows.length > 0) continue

        await query(
          `INSERT INTO sub_categories (main_category_id, name, slug)
           VALUES ($1, $2, $3)`,
          [mainId, subName, subSlug],
        )
        subsCreated += 1
      }
    }

    return { mainsCreated, subsCreated }
  },

  async validateSubcategoryName(name) {
    await ensureCategoryTables()
    const trimmed = String(name || '').trim()
    if (!trimmed) throw new AppError('Category is required', 400)

    const result = await query(
      `SELECT s.name, m.name AS main_name
       FROM sub_categories s
       JOIN main_categories m ON m.id = s.main_category_id
       WHERE LOWER(s.name) = LOWER($1)`,
      [trimmed],
    )

    if (result.rows.length === 0) {
      throw new AppError('Please select a valid subcategory', 400)
    }

    return result.rows[0].name
  },

  /**
   * Ensure every business.category exists as a CRM subcategory.
   * Creates missing ones under "Imported Categories" (or under a matching main).
   * Normalizes business.category to the exact CRM subcategory name.
   */
  async syncBusinessCategories() {
    await ensureCategoryTables()
    await this.seedDefaultCategories()

    const decode = (value) =>
      String(value || '')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#039;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()

    async function uniqueSlug(base) {
      let candidate = base || 'category'
      let n = 2
      while (true) {
        const existing = await query(
          `SELECT id FROM sub_categories WHERE slug = $1
           UNION ALL
           SELECT id FROM main_categories WHERE slug = $1`,
          [candidate],
        )
        if (existing.rows.length === 0) return candidate
        candidate = `${base}-${n}`
        n += 1
      }
    }

    async function ensureMain(name) {
      const trimmed = decode(name)
      const existing = await query(
        `SELECT id, name FROM main_categories WHERE LOWER(name) = LOWER($1)`,
        [trimmed],
      )
      if (existing.rows[0]) return existing.rows[0]
      const sortOrderResult = await query(
        'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM main_categories',
      )
      const slug = await uniqueSlug(slugify(trimmed))
      const inserted = await query(
        `INSERT INTO main_categories (name, slug, sort_order)
         VALUES ($1, $2, $3) RETURNING id, name`,
        [trimmed, slug, sortOrderResult.rows[0].next],
      )
      return inserted.rows[0]
    }

    async function ensureSub(mainId, name) {
      const trimmed = decode(name)
      const existing = await query(
        `SELECT id, name FROM sub_categories WHERE LOWER(name) = LOWER($1) LIMIT 1`,
        [trimmed],
      )
      if (existing.rows[0]) return { ...existing.rows[0], created: false }
      const slug = await uniqueSlug(slugify(trimmed))
      const inserted = await query(
        `INSERT INTO sub_categories (main_category_id, name, slug)
         VALUES ($1, $2, $3) RETURNING id, name`,
        [mainId, trimmed, slug],
      )
      return { ...inserted.rows[0], created: true }
    }

    const importedMain = await ensureMain('Imported Categories')
    const businessCats = await query(`
      SELECT DISTINCT TRIM(category) AS category
      FROM businesses
      WHERE category IS NOT NULL AND TRIM(category) <> ''
      ORDER BY 1
    `)

    let createdSubs = 0
    let businessesUpdated = 0
    let matchedExisting = 0

    for (const row of businessCats.rows) {
      const stored = String(row.category || '').trim()
      const raw = decode(stored)
      if (!raw) continue

      let sub = (
        await query(
          `SELECT id, name FROM sub_categories WHERE LOWER(name) = LOWER($1) LIMIT 1`,
          [raw],
        )
      ).rows[0]

      if (!sub) {
        const mainMatch = (
          await query(
            `SELECT id FROM main_categories WHERE LOWER(name) = LOWER($1) LIMIT 1`,
            [raw],
          )
        ).rows[0]
        const ensured = await ensureSub(mainMatch?.id || importedMain.id, raw)
        sub = ensured
        if (ensured.created) createdSubs += 1
      } else {
        matchedExisting += 1
      }

      const updated = await query(
        `UPDATE businesses
         SET category = $1, updated_at = NOW()
         WHERE category IS DISTINCT FROM $1
           AND (
             LOWER(TRIM(category)) = LOWER($2)
             OR LOWER(TRIM(category)) = LOWER($3)
             OR REPLACE(LOWER(TRIM(category)), '&amp;', '&') = LOWER($2)
           )`,
        [sub.name, raw, stored],
      )
      businessesUpdated += updated.rowCount || 0
    }

    const totals = await query(`
      SELECT
        (SELECT COUNT(*)::int FROM main_categories) AS mains,
        (SELECT COUNT(*)::int FROM sub_categories) AS subs
    `)

    return {
      uniqueBusinessCategories: businessCats.rows.length,
      createdSubs,
      matchedExisting,
      businessesUpdated,
      mains: totals.rows[0].mains,
      subs: totals.rows[0].subs,
    }
  },
}
