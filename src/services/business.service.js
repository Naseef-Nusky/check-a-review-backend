import { query } from '../db/pool.js'
import { AppError, slugify, paginate } from '../utils/helpers.js'
import { categoryService } from './category.service.js'
import { pricingContentService } from './pricing-content.service.js'
import { emailService } from './email.service.js'
import { notificationService } from './notification.service.js'
import {
  MEDIA_KIND,
  businessLogoPublicPath,
  mediaService,
} from './media.service.js'
import { assertBusinessAccess, assertBusinessOwner, getBusinessForUser } from './businessAccess.service.js'

let statusColumnReady = false

/** Existing businesses are treated as published; every new self-serve listing starts pending. */
export async function ensureBusinessStatusColumn() {
  if (statusColumnReady) return
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'businesses' AND column_name = 'status'
      ) THEN
        ALTER TABLE businesses
          ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'published';
        ALTER TABLE businesses
          ADD CONSTRAINT businesses_status_check
          CHECK (status IN ('pending', 'published', 'rejected'));
        ALTER TABLE businesses ALTER COLUMN status SET DEFAULT 'pending';
      END IF;
    END $$;
    `)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_color VARCHAR(20)`)
  statusColumnReady = true
}

async function updateBusinessStats(businessId) {
  await query('ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ai_review_summary JSONB')
  await query(
    `UPDATE businesses SET
      average_rating = COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM reviews WHERE business_id = $1 AND status = 'published'), 0),
      review_count = (SELECT COUNT(*) FROM reviews WHERE business_id = $1 AND status = 'published'),
      trust_score = LEAST(100, GREATEST(0,
        COALESCE((SELECT ROUND(AVG(rating)::numeric * 20, 2) FROM reviews WHERE business_id = $1 AND status = 'published'), 0)
      )),
      ai_review_summary = NULL,
      updated_at = NOW()
     WHERE id = $1`,
    [businessId],
  )
}

export const businessService = {
  async search({ q, category, page, limit, offset }) {
    await ensureBusinessStatusColumn()
    let where = "WHERE b.status = 'published'"
    const params = []
    let idx = 1

    if (q) {
      where += ` AND b.name ILIKE $${idx}`
      params.push(`%${String(q).trim()}%`)
      idx++
    }
    if (category) {
      where += ` AND b.category ILIKE $${idx}`
      params.push(`%${String(category).trim()}%`)
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

  async getFeatured() {
    await ensureBusinessStatusColumn()
    const { settingsService } = await import('./settings.service.js')
    const featuredIds = await settingsService.getFeaturedBusinessIds()

    if (featuredIds.length === 0) {
      return this.search({ page: 1, limit: 4, offset: 0 })
    }

    const result = await query(
      `SELECT b.*, s.plan as subscription_plan
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       WHERE b.id = ANY($1::uuid[]) AND b.status = 'published'
       ORDER BY array_position($1::uuid[], b.id)`,
      [featuredIds],
    )

    return {
      businesses: result.rows,
      total: result.rows.length,
      page: 1,
      limit: 4,
      curated: true,
    }
  },

  async getBySlugOrId(identifier, { includeUnpublished = false } = {}) {
    await ensureBusinessStatusColumn()
    const result = await query(
      `SELECT b.*, s.plan as subscription_plan, u.name as owner_name
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE (b.slug = $1 OR b.id::text = $1)
         AND ($2::boolean OR b.status = 'published')`,
      [identifier, includeUnpublished],
    )
    if (result.rows.length === 0) throw new AppError('Business not found', 404)
    return result.rows[0]
  },

  async getCategories() {
    return categoryService.getCategoryTree()
  },

  async getPricingContent() {
    return pricingContentService.getBusinessPricingContent()
  },

  async getByUserId(userId) {
    await ensureBusinessStatusColumn()
    return getBusinessForUser(userId)
  },

  async update(businessId, userId, data) {
    await assertBusinessAccess(businessId, userId)

    let category = data.category
    if (category) {
      try {
        category = await categoryService.validateSubcategoryName(category)
      } catch {
        // Allow existing/legacy category names so profile edits still save
        category = String(category).trim()
      }
    }

    if (data.website !== undefined && String(data.website).trim()) {
      const { domainService } = await import('./domain.service.js')
      await domainService.assertWebsiteResolves(data.website)
    }

    const clearingLogo =
      (data.logoUrl !== undefined || data.logo_url !== undefined) &&
      !(data.logoUrl || data.logo_url)

    if (clearingLogo) {
      await mediaService.deleteImage(MEDIA_KIND.BUSINESS_LOGO, businessId)
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
        logo_url = CASE WHEN $11 THEN $8 ELSE logo_url END,
        slug = CASE WHEN $1 IS NOT NULL THEN $9 ELSE slug END,
        updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [
        data.name ?? null,
        category ?? null,
        data.description !== undefined ? data.description : null,
        data.website !== undefined ? data.website : null,
        data.email !== undefined ? data.email : null,
        data.phone !== undefined ? data.phone : null,
        data.address !== undefined ? data.address : null,
        clearingLogo ? null : data.logoUrl ?? data.logo_url ?? null,
        data.name ? slugify(data.name) : null,
        businessId,
        data.logoUrl !== undefined || data.logo_url !== undefined,
      ],
    )
    const row = result.rows[0]
    if (data.brandColor !== undefined && row) {
      const { getEntitlements } = await import('./planEntitlements.service.js')
      const entitlements = await getEntitlements(businessId)
      if (!entitlements.flags.brandMatch) {
        throw new AppError('Brand matching is included from Plus. Upgrade to match your public profile to your brand.', 403, 'BRAND_PLAN')
      }
      await query(`UPDATE businesses SET brand_color = $1, updated_at = NOW() WHERE id = $2`, [
        String(data.brandColor || '').trim() || null,
        businessId,
      ])
    }
    if (data.website !== undefined && row) {
      const { domainService } = await import('./domain.service.js')
      await domainService.syncFromWebsiteField(businessId, data.website, userId)
      const refreshed = await query('SELECT * FROM businesses WHERE id = $1', [businessId])
      return refreshed.rows[0] || row
    }
    return row
  },

  async updateLogo(businessId, userId, { buffer, mimeType, clear = false } = {}) {
    await assertBusinessAccess(businessId, userId)

    if (clear || (!buffer && !mimeType)) {
      await mediaService.deleteImage(MEDIA_KIND.BUSINESS_LOGO, businessId)
      const cleared = await query(
        `UPDATE businesses SET logo_url = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [businessId],
      )
      return cleared.rows[0]
    }

    await mediaService.upsertImage({
      kind: MEDIA_KIND.BUSINESS_LOGO,
      refId: businessId,
      mimeType,
      buffer,
    })

    const logoUrl = businessLogoPublicPath(businessId)
    const result = await query(
      `UPDATE businesses SET logo_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [logoUrl, businessId],
    )
    return result.rows[0]
  },

  async clearLogoById(businessId) {
    await mediaService.deleteImage(MEDIA_KIND.BUSINESS_LOGO, businessId)
    const result = await query(
      `UPDATE businesses SET logo_url = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [businessId],
    )
    return result.rows[0] || null
  },

  async getAnalytics(businessId, userId) {
    await assertBusinessAccess(businessId, userId)
    const business = await this.getBySlugOrId(businessId, { includeUnpublished: true })

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

    const invitationStats = await query(
      `SELECT
         COUNT(*) FILTER (WHERE sent_at >= date_trunc('month', NOW()))::int AS invited_this_month,
         COUNT(*) FILTER (WHERE status = 'reviewed' AND COALESCE(reviewed_at, sent_at) >= date_trunc('month', NOW()))::int AS reviewed_this_month
       FROM review_invitations
       WHERE business_id = $1`,
      [businessId],
    )

    const { getEntitlements } = await import('./planEntitlements.service.js')
    const entitlements = await getEntitlements(businessId)

    return {
      business,
      ratingBreakdown: breakdown.rows,
      monthlyTrend: monthly.rows,
      invitationStats: invitationStats.rows[0] || { invited_this_month: 0, reviewed_this_month: 0 },
      entitlements,
    }
  },

  async getPending() {
    await ensureBusinessStatusColumn()
    const result = await query(
      `SELECT b.*,
              u.email as owner_email,
              u.name as owner_name
       FROM businesses b
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.status = 'pending'
       ORDER BY b.created_at ASC`,
    )
    return result.rows
  },

  async moderate(businessId, status) {
    await ensureBusinessStatusColumn()
    if (!['published', 'rejected', 'pending'].includes(status)) {
      throw new AppError('Invalid business status', 400)
    }

    const before = await query('SELECT * FROM businesses WHERE id = $1', [businessId])
    if (before.rows.length === 0) throw new AppError('Business not found', 404)
    const previousStatus = before.rows[0].status

    const result = await query(
      `UPDATE businesses SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, businessId],
    )
    const business = result.rows[0]
    const owner = await query('SELECT id, email, name FROM users WHERE id = $1', [business.user_id])

    if (owner.rows[0]) {
      if (status === 'published' && previousStatus !== 'published') {
        await emailService.sendBusinessApprovedEmail(owner.rows[0].email, business.name)
        await notificationService.create(
          owner.rows[0].id,
          'Business listing approved',
          `${business.name} is now live on Check A Review.`,
          'business_approved',
        )
        const { searchIndexService } = await import('./searchIndex.service.js')
        searchIndexService.notifyBusinessPublished(business)
        const { claimService } = await import('./claim.service.js')
        await claimService.markBusinessClaimed(business.id)
      }

      if (status === 'rejected' && previousStatus !== 'rejected') {
        await emailService.sendBusinessRejectedEmail(owner.rows[0].email, business.name)
        await notificationService.create(
          owner.rows[0].id,
          'Business listing not approved',
          `${business.name} was not approved. Update your details and contact support if you need help.`,
          'business_rejected',
        )
      }
    }

    return business
  },

  async removeBusinessRecord(businessId) {
    await ensureBusinessStatusColumn()
    const existing = await query('SELECT * FROM businesses WHERE id = $1', [businessId])
    if (existing.rows.length === 0) throw new AppError('Business not found', 404)

    const ownerId = existing.rows[0].user_id
    const sub = await query(
      'SELECT square_subscription_id FROM subscriptions WHERE business_id = $1',
      [businessId],
    )
    const squareSubId = sub.rows[0]?.square_subscription_id

    if (squareSubId) {
      try {
        const { squareService } = await import('./square.service.js')
        if (squareService.hasCredentials()) {
          await squareService.cancelSubscription(squareSubId)
        }
      } catch (err) {
        console.error('Could not cancel Square subscription before business delete:', err.message)
      }
    }

    try {
      await mediaService.deleteImage(MEDIA_KIND.BUSINESS_LOGO, businessId)
    } catch {
      // ignore missing logo
    }

    await query('DELETE FROM businesses WHERE id = $1', [businessId])

    if (ownerId) {
      await query(`DELETE FROM users WHERE id = $1 AND role = 'business'`, [ownerId])
    }

    return { id: businessId, deleted: true }
  },

  async deleteOwnedBusiness(businessId, userId) {
    await assertBusinessOwner(businessId, userId)
    return this.removeBusinessRecord(businessId)
  },

  updateBusinessStats,
  ensureBusinessStatusColumn,
}
