import bcrypt from 'bcryptjs'
import { query } from '../db/pool.js'
import { AppError, slugify } from '../utils/helpers.js'
import { categoryService } from './category.service.js'

export const adminService = {
  async getDashboardStats() {
    const [users, businesses, reviews, revenue, flagged] = await Promise.all([
      query(`SELECT COUNT(*) FROM users WHERE role = 'customer'`),
      query('SELECT COUNT(*) FROM businesses'),
      query('SELECT COUNT(*) FROM reviews'),
      query(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'succeeded'`),
      query(`SELECT COUNT(*) FROM reviews WHERE status = 'pending' AND ai_risk_score > 0`),
    ])

    return {
      totalCustomers: parseInt(users.rows[0].count, 10),
      totalBusinesses: parseInt(businesses.rows[0].count, 10),
      totalReviews: parseInt(reviews.rows[0].count, 10),
      totalRevenue: parseInt(revenue.rows[0].total, 10),
      flaggedReviews: parseInt(flagged.rows[0].count, 10),
    }
  },

  async getUsers() {
    const result = await query(
      `SELECT u.id, u.name, u.email, u.role, u.email_verified, u.created_at,
              (SELECT COUNT(*) FROM reviews WHERE user_id = u.id) as review_count
       FROM users u WHERE u.role = 'customer' ORDER BY u.created_at DESC`,
    )
    return result.rows
  },

  async getBusinesses() {
    const result = await query(
      `SELECT b.*, s.plan, u.email as owner_email
       FROM businesses b
       LEFT JOIN subscriptions s ON s.business_id = b.id
       LEFT JOIN users u ON u.id = b.user_id
       ORDER BY b.created_at DESC`,
    )
    return result.rows
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

    const existingUser = await query('SELECT id FROM users WHERE email = $1', [emailLower])
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

    const businessResult = await query(
      `INSERT INTO businesses (user_id, name, slug, category, description, website, email, phone, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [userResult.rows[0].id, name, slug, validatedCategory, description, website, emailLower, phone, address],
    )

    const businessId = businessResult.rows[0].id
    await query(`INSERT INTO subscriptions (business_id, plan) VALUES ($1, 'free')`, [businessId])

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

  async getAllReviews() {
    const result = await query(
      `SELECT r.*, u.name as author_name, b.name as business_name
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN businesses b ON b.id = r.business_id
       ORDER BY r.created_at DESC`,
    )
    return result.rows
  },

  async getSubscriptions() {
    const result = await query(
      `SELECT s.*, b.name as business_name FROM subscriptions s
       JOIN businesses b ON b.id = s.business_id ORDER BY s.created_at DESC`,
    )
    return result.rows
  },

  async getPayments() {
    const result = await query(
      `SELECT p.*, b.name as business_name FROM payments p
       JOIN businesses b ON b.id = p.business_id ORDER BY p.created_at DESC`,
    )
    return result.rows
  },

  async getSettings() {
    const result = await query('SELECT * FROM website_settings LIMIT 1')
    return result.rows[0]
  },

  async updateSettings(data) {
    const result = await query(
      `UPDATE website_settings SET
        site_name = COALESCE($1, site_name),
        support_email = COALESCE($2, support_email),
        ai_moderation_enabled = COALESCE($3, ai_moderation_enabled),
        auto_publish_threshold = COALESCE($4, auto_publish_threshold),
        email_provider = COALESCE($5, email_provider),
        updated_at = NOW()
       RETURNING *`,
      [data.siteName, data.supportEmail, data.aiModeration, data.autoPublishThreshold, data.emailProvider],
    )
    return result.rows[0]
  },
}
