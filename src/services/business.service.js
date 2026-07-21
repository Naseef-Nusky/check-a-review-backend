import { query } from '../db/pool.js'
import { AppError, slugify, paginate } from '../utils/helpers.js'
import { categoryService } from './category.service.js'

async function updateBusinessStats(businessId) {
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
}

export const businessService = {
  async search({ q, category, page, limit, offset }) {
    let where = 'WHERE 1=1'
    const params = []
    let idx = 1

    if (q) {
      where += ` AND (b.name ILIKE $${idx} OR b.category ILIKE $${idx})`
      params.push(`%${q}%`)
      idx++
    }
    if (category) {
      where += ` AND b.category ILIKE $${idx}`
      params.push(`%${category}%`)
      idx++
    }

    const countResult = await query(`SELECT COUNT(*) FROM businesses b ${where}`, params)
    const total = parseInt(countResult.rows[0].count, 10)

    params.push(limit, offset)
    const result = await query(
      `SELECT b.*, s.plan as subscription_plan
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       ${where}
       ORDER BY b.average_rating DESC, b.review_count DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    )

    return { businesses: result.rows, total, page, limit }
  },

  async getBySlugOrId(identifier) {
    const result = await query(
      `SELECT b.*, s.plan as subscription_plan, u.name as owner_name
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.slug = $1 OR b.id::text = $1`,
      [identifier],
    )
    if (result.rows.length === 0) throw new AppError('Business not found', 404)
    return result.rows[0]
  },

  async getCategories() {
    return categoryService.getCategoryTree()
  },

  async getByUserId(userId) {
    const result = await query('SELECT * FROM businesses WHERE user_id = $1', [userId])
    if (result.rows.length === 0) throw new AppError('Business not found', 404)
    return result.rows[0]
  },

  async update(businessId, userId, data) {
    const owner = await query('SELECT id FROM businesses WHERE id = $1 AND user_id = $2', [businessId, userId])
    if (owner.rows.length === 0) throw new AppError('Business not found or access denied', 403)

    let category = data.category
    if (category) {
      category = await categoryService.validateSubcategoryName(category)
    }

    const result = await query(
      `UPDATE businesses SET
        name = COALESCE($1, name),
        category = COALESCE($2, category),
        description = COALESCE($3, description),
        website = COALESCE($4, website),
        email = COALESCE($5, email),
        phone = COALESCE($6, phone),
        address = COALESCE($7, address),
        slug = CASE WHEN $1 IS NOT NULL THEN $8 ELSE slug END,
        updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [
        data.name,
        category,
        data.description,
        data.website,
        data.email,
        data.phone,
        data.address,
        data.name ? slugify(data.name) : null,
        businessId,
      ],
    )
    return result.rows[0]
  },

  async getAnalytics(businessId, userId) {
    const business = await this.getByUserId(userId)
    if (business.id !== businessId) throw new AppError('Access denied', 403)

    const breakdown = await query(
      `SELECT rating, COUNT(*) as count FROM reviews
       WHERE business_id = $1 AND status = 'published'
       GROUP BY rating ORDER BY rating DESC`,
      [businessId],
    )

    const monthly = await query(
      `SELECT TO_CHAR(created_at, 'Mon') as month, COUNT(*) as count
       FROM reviews WHERE business_id = $1 AND status = 'published'
       AND created_at >= NOW() - INTERVAL '7 months'
       GROUP BY TO_CHAR(created_at, 'Mon'), DATE_TRUNC('month', created_at)
       ORDER BY DATE_TRUNC('month', created_at)`,
      [businessId],
    )

    return {
      business,
      ratingBreakdown: breakdown.rows,
      monthlyTrend: monthly.rows,
    }
  },

  updateBusinessStats,
}
