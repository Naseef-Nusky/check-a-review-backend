import { v4 as uuidv4 } from 'uuid'
import { query } from '../db/pool.js'
import { AppError, paginate } from '../utils/helpers.js'
import { aiModerationService } from './aiModeration.service.js'
import { emailService } from './email.service.js'
import { businessService } from './business.service.js'
import { notificationService } from './notification.service.js'

export const reviewService = {
  async create({ businessId, userId, rating, title, content }) {
    const business = await query('SELECT * FROM businesses WHERE id = $1', [businessId])
    if (business.rows.length === 0) throw new AppError('Business not found', 404)

    const existing = await query(
      'SELECT id FROM reviews WHERE business_id = $1 AND user_id = $2',
      [businessId, userId],
    )
    if (existing.rows.length > 0) throw new AppError('You have already reviewed this business', 409)

    const analysis = await aiModerationService.analyzeReview({
      title,
      content,
      rating,
      businessName: business.rows[0].name,
    })

    const status = aiModerationService.shouldAutoPublish(analysis) ? 'published' : 'pending'

    const result = await query(
      `INSERT INTO reviews (business_id, user_id, rating, title, content, status, ai_risk_score, ai_flags, ai_analysis)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        businessId,
        userId,
        rating,
        title,
        content,
        status,
        analysis.riskScore,
        JSON.stringify(analysis.flags),
        JSON.stringify(analysis),
      ],
    )
    const review = result.rows[0]

    const user = await query('SELECT email, name FROM users WHERE id = $1', [userId])
    await emailService.sendReviewConfirmation(user.rows[0].email, business.rows[0].name)

    if (status === 'published') {
      await emailService.sendReviewPublishedEmail(user.rows[0].email, business.rows[0].name)
      await businessService.updateBusinessStats(businessId)

      const owner = await query('SELECT u.email FROM users u JOIN businesses b ON b.user_id = u.id WHERE b.id = $1', [businessId])
      if (owner.rows[0]) {
        await emailService.sendNewReviewNotification(owner.rows[0].email, business.rows[0].name, rating)
      }
    }

    await notificationService.create(userId, 'Review Submitted', `Your review for ${business.rows[0].name} is ${status}.`, 'review_submitted')

    return { review, aiAnalysis: analysis }
  },

  async update(reviewId, userId, { rating, title, content }) {
    const existing = await query('SELECT * FROM reviews WHERE id = $1 AND user_id = $2', [reviewId, userId])
    if (existing.rows.length === 0) throw new AppError('Review not found', 404)

    const business = await query('SELECT name FROM businesses WHERE id = $1', [existing.rows[0].business_id])
    const analysis = await aiModerationService.analyzeReview({
      title: title ?? existing.rows[0].title,
      content: content ?? existing.rows[0].content,
      rating: rating ?? existing.rows[0].rating,
      businessName: business.rows[0].name,
    })

    const status = aiModerationService.shouldAutoPublish(analysis) ? 'published' : 'pending'

    const result = await query(
      `UPDATE reviews SET
        rating = COALESCE($1, rating), title = COALESCE($2, title), content = COALESCE($3, content),
        status = $4, ai_risk_score = $5, ai_flags = $6, ai_analysis = $7, updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [rating, title, content, status, analysis.riskScore, JSON.stringify(analysis.flags), JSON.stringify(analysis), reviewId],
    )

    await businessService.updateBusinessStats(existing.rows[0].business_id)
    return { review: result.rows[0], aiAnalysis: analysis }
  },

  async getLatest(queryParams) {
    const { page, limit, offset } = paginate(queryParams)
    const result = await query(
      `SELECT r.*, u.name as author_name, b.name as business_name, b.slug as business_slug
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN businesses b ON b.id = r.business_id
       WHERE r.status = 'published'
       ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    )
    const count = await query(`SELECT COUNT(*) FROM reviews WHERE status = 'published'`)
    return { reviews: result.rows, total: parseInt(count.rows[0].count, 10), page, limit }
  },

  async getByBusiness(businessId, queryParams) {
    const { page, limit, offset } = paginate(queryParams)
    const result = await query(
      `SELECT r.*, u.name as author_name
       FROM reviews r JOIN users u ON u.id = r.user_id
       WHERE r.business_id = $1 AND r.status = 'published'
       ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
      [businessId, limit, offset],
    )
    return { reviews: result.rows, page, limit }
  },

  async getByUser(userId) {
    const result = await query(
      `SELECT r.*, b.name as business_name, b.slug as business_slug
       FROM reviews r JOIN businesses b ON b.id = r.business_id
       WHERE r.user_id = $1 ORDER BY r.created_at DESC`,
      [userId],
    )
    return result.rows
  },

  async reply(reviewId, userId, reply) {
    const review = await query(
      `SELECT r.*, b.user_id as business_owner_id, b.name as business_name
       FROM reviews r JOIN businesses b ON b.id = r.business_id WHERE r.id = $1`,
      [reviewId],
    )
    if (review.rows.length === 0) throw new AppError('Review not found', 404)
    if (review.rows[0].business_owner_id !== userId) throw new AppError('Access denied', 403)

    const result = await query(
      `UPDATE reviews SET business_reply = $1, business_reply_at = NOW(), updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [reply, reviewId],
    )

    const reviewer = await query('SELECT email FROM users WHERE id = $1', [review.rows[0].user_id])
    if (reviewer.rows[0]) {
      await emailService.sendBusinessReplyNotification(reviewer.rows[0].email, review.rows[0].business_name)
      await notificationService.create(
        review.rows[0].user_id,
        'Business Reply',
        `${review.rows[0].business_name} replied to your review.`,
        'business_reply',
      )
    }

    return result.rows[0]
  },

  async moderate(reviewId, status) {
    const result = await query(
      `UPDATE reviews SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, reviewId],
    )
    if (result.rows.length === 0) throw new AppError('Review not found', 404)

    await businessService.updateBusinessStats(result.rows[0].business_id)

    if (status === 'published') {
      const user = await query('SELECT email FROM users WHERE id = $1', [result.rows[0].user_id])
      const business = await query('SELECT name FROM businesses WHERE id = $1', [result.rows[0].business_id])
      if (user.rows[0] && business.rows[0]) {
        await emailService.sendReviewPublishedEmail(user.rows[0].email, business.rows[0].name)
      }
    }

    return result.rows[0]
  },

  async getFlagged() {
    const result = await query(
      `SELECT r.*, u.name as author_name, b.name as business_name
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN businesses b ON b.id = r.business_id
       WHERE r.status = 'pending' AND r.ai_risk_score > 0
       ORDER BY r.ai_risk_score DESC`,
    )
    return result.rows
  },

  async sendInvitation(businessId, userId, email) {
    const business = await query('SELECT * FROM businesses WHERE id = $1 AND user_id = $2', [businessId, userId])
    if (business.rows.length === 0) throw new AppError('Business not found or access denied', 403)

    const token = uuidv4()
    const result = await query(
      `INSERT INTO review_invitations (business_id, email, token) VALUES ($1, $2, $3) RETURNING *`,
      [businessId, email.toLowerCase(), token],
    )

    const inviteUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/review-invite/${token}`
    await emailService.sendReviewInvitation(email, business.rows[0].name, inviteUrl)

    return result.rows[0]
  },

  async getInvitations(businessId, userId) {
    const business = await query('SELECT id FROM businesses WHERE id = $1 AND user_id = $2', [businessId, userId])
    if (business.rows.length === 0) throw new AppError('Access denied', 403)

    const result = await query(
      'SELECT * FROM review_invitations WHERE business_id = $1 ORDER BY sent_at DESC',
      [businessId],
    )
    return result.rows
  },
}
