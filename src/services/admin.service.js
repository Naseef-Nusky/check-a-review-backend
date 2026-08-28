import bcrypt from 'bcryptjs'
import { query } from '../db/pool.js'
import { AppError, slugify } from '../utils/helpers.js'
import { categoryService } from './category.service.js'
import { pricingContentService } from './pricing-content.service.js'
import { bumpTokenVersion } from '../utils/session.js'
import { ensureBusinessStatusColumn, businessService } from './business.service.js'

let crmRolesReady = false

export const adminService = {
  async getDashboardStats() {
    await ensureBusinessStatusColumn()
    const [users, businesses, reviews, revenue, flagged, pendingBusinesses, revenueCurrencyRow] = await Promise.all([
      query(`SELECT COUNT(*) FROM users WHERE role = 'customer'`),
      query(`SELECT COUNT(*) FROM businesses WHERE status = 'published'`),
      query('SELECT COUNT(*) FROM reviews'),
      query(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'succeeded'`),
      query(`SELECT COUNT(*) FROM reviews WHERE status = 'pending'`),
      query(`SELECT COUNT(*) FROM businesses WHERE status = 'pending'`),
      query(
        `SELECT currency, COUNT(*)::int AS count
         FROM payments
         WHERE status = 'succeeded' AND currency IS NOT NULL AND currency <> ''
         GROUP BY currency
         ORDER BY count DESC
         LIMIT 1`,
      ),
    ])

    const revenueCurrency = String(revenueCurrencyRow.rows[0]?.currency || 'GBP').toUpperCase()

    return {
      totalUsers: parseInt(users.rows[0].count, 10),
      totalCustomers: parseInt(users.rows[0].count, 10),
      totalBusinesses: parseInt(businesses.rows[0].count, 10),
      totalReviews: parseInt(reviews.rows[0].count, 10),
      totalRevenue: parseInt(revenue.rows[0].total, 10),
      revenueCurrency,
      flaggedReviews: parseInt(flagged.rows[0].count, 10),
      pendingBusinesses: parseInt(pendingBusinesses.rows[0].count, 10),
    }
  },

  async getUsers() {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.email_verified, u.created_at,
              (SELECT COUNT(*) FROM reviews WHERE user_id = u.id) as review_count
       FROM users u
       WHERE u.role = 'customer'
       ORDER BY u.created_at DESC`,
    )
    return result.rows
  },

  async updateUser(id, { name, email, password, email_verified }) {
    const existing = await query(
      `SELECT * FROM users WHERE id = $1 AND role = 'customer'`,
      [id],
    )
    if (existing.rows.length === 0) throw new AppError('User not found', 404)
    const user = existing.rows[0]

    let nextEmail = user.email
    if (email !== undefined && email !== null && String(email).trim()) {
      nextEmail = String(email).trim().toLowerCase()
      if (nextEmail !== user.email) {
        const taken = await query(
          'SELECT id FROM users WHERE email = $1 AND role = $2 AND id <> $3',
          [nextEmail, user.role, id],
        )
        if (taken.rows.length > 0) {
          throw new AppError('Another account with this email already exists for this account type', 409)
        }
      }
    }

    let passwordHash = user.password_hash
    if (password && String(password).trim()) {
      passwordHash = await bcrypt.hash(String(password).trim(), 12)
    }

    const nextVerified =
      email_verified === undefined || email_verified === null
        ? user.email_verified
        : Boolean(email_verified)

    const result = await query(
      `UPDATE users SET
         name = COALESCE($1, name),
         email = $2,
         password_hash = $3,
         email_verified = $4,
         updated_at = NOW()
       WHERE id = $5
       RETURNING id, name, email, role, email_verified, created_at, updated_at`,
      [
        name !== undefined && name !== null ? String(name).trim() || null : null,
        nextEmail,
        passwordHash,
        nextVerified,
        id,
      ],
    )

    if (password && String(password).trim()) {
      await bumpTokenVersion(id)
    }

    const reviewCount = await query('SELECT COUNT(*) FROM reviews WHERE user_id = $1', [id])
    return {
      ...result.rows[0],
      review_count: parseInt(reviewCount.rows[0].count, 10),
    }
  },

  async deleteUser(id) {
    const existing = await query(
      `SELECT id, name FROM users WHERE id = $1 AND role = 'customer'`,
      [id],
    )
    if (existing.rows.length === 0) throw new AppError('User not found', 404)
    await query('DELETE FROM users WHERE id = $1', [id])
    return { message: `User "${existing.rows[0].name}" removed` }
  },

  async ensureCrmRoleConstraint() {
    if (crmRolesReady) return
    await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`)
    await query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('customer', 'business', 'admin', 'super_admin', 'viewer'))
    `)
    // Promote the seeded admin account to super_admin (existing installs)
    const { env } = await import('../config/env.js')
    if (env.ADMIN_EMAIL) {
      await query(
        `UPDATE users SET role = 'super_admin', updated_at = NOW()
         WHERE email = $1 AND role = 'admin'`,
        [env.ADMIN_EMAIL],
      )
    }
    crmRolesReady = true
  },

  async getStaff() {
    await this.ensureCrmRoleConstraint()
    const result = await query(
      `SELECT id, name, email, role, email_verified, created_at, updated_at
       FROM users
       WHERE role IN ('super_admin', 'admin', 'viewer')
       ORDER BY
         CASE role
           WHEN 'super_admin' THEN 0
           WHEN 'admin' THEN 1
           ELSE 2
         END,
         created_at ASC`,
    )
    return result.rows
  },

  async createStaff({ name, email, password, role }) {
    await this.ensureCrmRoleConstraint()
    if (!['admin', 'viewer'].includes(role)) {
      throw new AppError('Role must be admin or viewer', 400)
    }

    const existing = await query(
      `SELECT id FROM users WHERE email = $1 AND role IN ('super_admin', 'admin', 'viewer')`,
      [email.toLowerCase()],
    )
    if (existing.rows.length > 0) {
      throw new AppError('Email already registered', 409)
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const result = await query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING id, name, email, role, email_verified, created_at, updated_at`,
      [email.toLowerCase(), passwordHash, name.trim(), role],
    )
    return result.rows[0]
  },

  async updateStaff(id, { name, email, password, role }, actorId) {
    await this.ensureCrmRoleConstraint()

    const existing = await query(
      `SELECT * FROM users WHERE id = $1 AND role IN ('super_admin', 'admin', 'viewer')`,
      [id],
    )
    if (existing.rows.length === 0) throw new AppError('CRM user not found', 404)
    const staff = existing.rows[0]

    if (staff.role === 'super_admin') {
      throw new AppError('Super admin accounts cannot be edited here', 403)
    }
    if (id === actorId) {
      throw new AppError('You cannot change your own CRM role or password from this screen', 400)
    }
    if (role && !['admin', 'viewer'].includes(role)) {
      throw new AppError('Role must be admin or viewer', 400)
    }

    let nextEmail = null
    if (email && email.toLowerCase() !== staff.email) {
      const taken = await query(
        `SELECT id FROM users
         WHERE email = $1 AND role IN ('super_admin', 'admin', 'viewer') AND id <> $2`,
        [email.toLowerCase(), id],
      )
      if (taken.rows.length > 0) throw new AppError('Email already registered', 409)
      nextEmail = email.toLowerCase()
    }

    let passwordHash = null
    if (password) {
      passwordHash = await bcrypt.hash(password, 12)
    }

    const result = await query(
      `UPDATE users SET
         name = COALESCE($1, name),
         email = COALESCE($2, email),
         role = COALESCE($3, role),
         password_hash = COALESCE($4, password_hash),
         updated_at = NOW()
       WHERE id = $5
       RETURNING id, name, email, role, email_verified, created_at, updated_at`,
      [name?.trim() || null, nextEmail, role || null, passwordHash, id],
    )
    if (password) {
      await bumpTokenVersion(id)
    }
    return result.rows[0]
  },

  async deleteStaff(id, actorId) {
    if (id === actorId) throw new AppError('You cannot delete your own account', 400)

    const existing = await query(
      `SELECT * FROM users WHERE id = $1 AND role IN ('super_admin', 'admin', 'viewer')`,
      [id],
    )
    if (existing.rows.length === 0) throw new AppError('CRM user not found', 404)
    if (existing.rows[0].role === 'super_admin') {
      throw new AppError('Super admin accounts cannot be deleted', 403)
    }

    await query('DELETE FROM users WHERE id = $1', [id])
    return { message: 'CRM user removed' }
  },

  async getBusinesses() {
    await ensureBusinessStatusColumn()
    const result = await query(
      `SELECT b.*,
              s.plan,
              s.status as subscription_status,
              s.current_period_end,
              u.email as owner_email,
              u.name as owner_name,
              u.created_at as owner_created_at
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       LEFT JOIN users u ON u.id = b.user_id
       ORDER BY
         CASE b.status WHEN 'pending' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
         b.created_at DESC`,
    )
    return result.rows
  },

  async getBusinessById(id) {
    const result = await query(
      `SELECT b.*,
              s.plan,
              s.pending_plan,
              s.status as subscription_status,
              s.square_customer_id,
              s.square_subscription_id,
              s.current_period_end,
              s.updated_at as subscription_updated_at,
              s.created_at as subscription_created_at,
              u.email as owner_email,
              u.name as owner_name,
              u.id as owner_id,
              u.email_verified as owner_email_verified,
              u.created_at as owner_created_at
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [id],
    )
    if (result.rows.length === 0) throw new AppError('Business not found', 404)
    return result.rows[0]
  },

  async getCategories() {
    return categoryService.getCategoryTree()
  },

  async createMainCategory(name) {
    return categoryService.createMainCategory(name)
  },

  async createSubCategory(mainCategoryId, name) {
    return categoryService.createSubCategory(mainCategoryId, name)
  },

  async updateMainCategory(id, name) {
    return categoryService.updateMainCategory(id, name)
  },

  async updateSubCategory(id, data) {
    return categoryService.updateSubCategory(id, data)
  },

  async deleteMainCategory(id) {
    return categoryService.deleteMainCategory(id)
  },

  async deleteSubCategory(id) {
    return categoryService.deleteSubCategory(id)
  },

  async seedCategories() {
    return categoryService.seedDefaultCategories()
  },

  async createBusiness(data) {
    await ensureBusinessStatusColumn()
    const {
      name,
      email,
      password,
      category,
      description = null,
      website = null,
      phone = null,
      address = null,
    } = data

    const emailLower = String(email).toLowerCase()
    const slug = slugify(name)

    const existingUser = await query('SELECT id, role FROM users WHERE email = $1 AND role = $2', [
      emailLower,
      'business',
    ])
    if (existingUser.rows.length > 0) {
      throw new AppError('Email already registered', 409)
    }

    const existingSlug = await query('SELECT id FROM businesses WHERE slug = $1', [slug])
    if (existingSlug.rows.length > 0) {
      throw new AppError('Business name already exists. Please use a different name.', 409)
    }

    const validatedCategory = await categoryService.validateSubcategoryName(category)

    const passwordHash = await bcrypt.hash(password, 12)
    const userResult = await query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'business', TRUE)
       RETURNING id`,
      [emailLower, passwordHash, name],
    )

    // Admin-created listings are approved immediately.
    const businessResult = await query(
      `INSERT INTO businesses (user_id, name, slug, category, description, website, email, phone, address, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'published')
       RETURNING id`,
      [userResult.rows[0].id, name, slug, validatedCategory, description, website, emailLower, phone, address],
    )

    const businessId = businessResult.rows[0].id
    await query(`INSERT INTO subscriptions (business_id, plan) VALUES ($1, 'free')`, [businessId])

    const { ensureOwnerMembership } = await import('./businessAccess.service.js')
    await ensureOwnerMembership(businessId, userResult.rows[0].id, emailLower)

    const result = await query(
      `SELECT b.*, s.plan, u.email as owner_email
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       LEFT JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [businessId],
    )

    return result.rows[0]
  },

  async updateBusiness(id, data) {
    const existing = await this.getBusinessById(id)
    const ownerId = existing.owner_id || existing.user_id

    const name = data.name?.trim() || existing.name
    const slug = slugify(name)
    if (slug !== existing.slug) {
      const slugConflict = await query('SELECT id FROM businesses WHERE slug = $1 AND id != $2', [slug, id])
      if (slugConflict.rows.length > 0) {
        throw new AppError('Business name already exists. Please use a different name.', 409)
      }
    }

    let category = existing.category
    if (data.category != null && String(data.category).trim() !== '') {
      const nextCategory = String(data.category).trim()
      if (nextCategory.toLowerCase() === String(existing.category || '').toLowerCase()) {
        category = existing.category
      } else {
        try {
          category = await categoryService.validateSubcategoryName(nextCategory)
        } catch {
          // Allow legacy / free-text categories in admin CRM
          category = nextCategory
        }
      }
    }

    const pickText = (key) => {
      if (!Object.prototype.hasOwnProperty.call(data, key)) return existing[key] ?? null
      const value = data[key]
      if (value === null || value === '') return null
      return value
    }

    const nextEmail = Object.prototype.hasOwnProperty.call(data, 'email')
      ? (data.email ? String(data.email).toLowerCase() : null)
      : existing.email

    await query(
      `UPDATE businesses SET
        name = $1,
        slug = $2,
        category = $3,
        description = $4,
        website = $5,
        email = $6,
        phone = $7,
        address = $8,
        updated_at = NOW()
       WHERE id = $9`,
      [
        name,
        slug,
        category,
        pickText('description'),
        pickText('website'),
        nextEmail,
        pickText('phone'),
        pickText('address'),
        id,
      ],
    )

    if (data.owner_email || data.owner_name) {
      const ownerEmail = data.owner_email ? String(data.owner_email).toLowerCase() : null
      if (ownerEmail && ownerEmail !== existing.owner_email) {
        const emailTaken = await query(
          `SELECT id FROM users WHERE email = $1 AND role = 'business' AND id != $2`,
          [ownerEmail, ownerId],
        )
        if (emailTaken.rows.length > 0) {
          throw new AppError('Owner email already in use', 409)
        }
      }

      await query(
        `UPDATE users SET
          name = COALESCE($1, name),
          email = COALESCE($2, email),
          updated_at = NOW()
         WHERE id = $3`,
        [data.owner_name?.trim() || null, ownerEmail, ownerId],
      )
    }

    if (data.plan || data.subscription_status) {
      await query(
        `UPDATE subscriptions SET
          plan = COALESCE($1, plan),
          status = COALESCE($2, status),
          updated_at = NOW()
         WHERE business_id = $3`,
        [data.plan || null, data.subscription_status || null, id],
      )
    }

    return this.getBusinessById(id)
  },

  async deleteBusiness(id) {
    await this.getBusinessById(id)
    return businessService.removeBusinessRecord(id)
  },

  async getAllReviews() {
    const result = await query(
      `SELECT r.*,
              u.name as author_name,
              u.email as author_email,
              b.name as business_name,
              b.id as business_id,
              b.slug as business_slug
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN businesses b ON b.id = r.business_id
       ORDER BY r.created_at DESC`,
    )
    return result.rows
  },

  async getReviewById(id) {
    const result = await query(
      `SELECT r.*,
              u.name as author_name,
              u.email as author_email,
              u.id as author_id,
              b.name as business_name,
              b.id as business_id,
              b.slug as business_slug,
              b.email as business_email,
              b.category as business_category
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN businesses b ON b.id = r.business_id
       WHERE r.id = $1`,
      [id],
    )
    if (result.rows.length === 0) throw new AppError('Review not found', 404)
    return result.rows[0]
  },

  async getSubscriptions() {
    const result = await query(
      `SELECT s.id,
              s.business_id,
              s.plan,
              s.pending_plan,
              s.status,
              s.current_period_end,
              s.square_customer_id,
              s.square_subscription_id,
              s.created_at,
              s.updated_at,
              b.name as business_name
       FROM subscriptions s
       JOIN businesses b ON b.id = s.business_id
       ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC`,
    )
    return result.rows
  },

  async getPayments() {
    const result = await query(
      `SELECT p.id,
              p.business_id,
              p.square_payment_id,
              p.amount,
              p.currency,
              p.plan,
              p.status,
              p.created_at,
              b.name as business_name
       FROM payments p
       JOIN businesses b ON b.id = p.business_id
       ORDER BY p.created_at DESC`,
    )
    return result.rows
  },

  async getBusinessPayments(businessId) {
    const result = await query(
      `SELECT p.id,
              p.business_id,
              p.square_payment_id,
              p.amount,
              p.currency,
              p.plan,
              p.status,
              p.created_at
       FROM payments p
       WHERE p.business_id = $1
       ORDER BY p.created_at DESC`,
      [businessId],
    )
    return result.rows
  },

  async getSettings() {
    const { settingsService } = await import('./settings.service.js')
    const brand = await settingsService.getBrandSettings()
    const result = await query('SELECT * FROM website_settings LIMIT 1')
    const row = result.rows[0] || {}
    return {
      ...row,
      // Prefer media path from DB-backed brand logo so CRM preview stays in sync
      logo_url: brand.logoPath || row.logo_url || null,
    }
  },

  async updateSettings(data) {
    const { settingsService } = await import('./settings.service.js')
    await settingsService.getBrandSettings()

    const threshold = data.autoPublishThreshold !== undefined && data.autoPublishThreshold !== null
      ? Math.min(100, Math.max(0, Number(data.autoPublishThreshold)))
      : null

    const result = await query(
      `UPDATE website_settings SET
        site_name = COALESCE($1, site_name),
        support_email = COALESCE($2, support_email),
        ai_moderation_enabled = COALESCE($3, ai_moderation_enabled),
        auto_publish_threshold = COALESCE($4, auto_publish_threshold),
        email_provider = 'sendgrid',
        updated_at = NOW()
       RETURNING *`,
      [data.siteName, data.supportEmail, data.aiModeration, threshold],
    )
    return result.rows[0]
  },

  async updateSiteLogo(logoUrl) {
    const { settingsService } = await import('./settings.service.js')
    return settingsService.updateSiteLogo(logoUrl)
  },

  async updateSiteLogoFromUpload(file) {
    const { settingsService } = await import('./settings.service.js')
    return settingsService.updateSiteLogoFromUpload(file)
  },

  async setBusinessLogo(businessId, { buffer, mimeType }) {
    const { MEDIA_KIND, businessLogoPublicPath, mediaService } = await import('./media.service.js')
    const existing = await query('SELECT id FROM businesses WHERE id = $1', [businessId])
    if (existing.rows.length === 0) throw new AppError('Business not found', 404)

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

  async removeSiteLogo() {
    const { settingsService } = await import('./settings.service.js')
    return settingsService.removeSiteLogo()
  },

  async getBusinessPricingContent() {
    return pricingContentService.getBusinessPricingContent()
  },

  async updateBusinessPricingContent(data) {
    return pricingContentService.updateBusinessPricingContent(data)
  },

  async listBillingPlans() {
    const { billingPlansService } = await import('./billingPlans.service.js')
    const { squareService } = await import('./square.service.js')
    const plans = await billingPlansService.list()
    return {
      squareConfigured: squareService.hasCredentials(),
      plans,
    }
  },

  async updateBillingPlan(planKey, data) {
    const { billingPlansService } = await import('./billingPlans.service.js')
    return billingPlansService.update(planKey, data)
  },

  async syncBillingPlan(planKey) {
    const { billingPlansService } = await import('./billingPlans.service.js')
    return billingPlansService.syncToSquare(planKey)
  },

  async syncAllBillingPlans() {
    const { billingPlansService } = await import('./billingPlans.service.js')
    return billingPlansService.syncAllToSquare()
  },
}
