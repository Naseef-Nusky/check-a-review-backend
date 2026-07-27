import { v4 as uuidv4 } from 'uuid'
import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { AppError, paginate } from '../utils/helpers.js'
import { aiModerationService } from './aiModeration.service.js'
import { emailService } from './email.service.js'
import { businessService } from './business.service.js'
import { notificationService } from './notification.service.js'

async function getBusinessOwner(businessId) {
  const owner = await query(
    `SELECT u.id, u.email, u.name, b.name as business_name
     FROM users u
     JOIN businesses b ON b.user_id = u.id
     WHERE b.id = $1`,
    [businessId],
  )
  return owner.rows[0] || null
}

async function notifyBusinessOwnerAboutReview({
  businessId,
  rating,
  authorName,
  status,
  isEdit = false,
}) {
  const owner = await getBusinessOwner(businessId)
  if (!owner) return

  const author = authorName || 'A customer'
  const title = isEdit ? 'Review updated' : 'New review received'
  const message = isEdit
    ? `${author} updated their ${rating}-star review for ${owner.business_name}. Status: ${status}.`
    : `${author} left a ${rating}-star review for ${owner.business_name}. Status: ${status}.`

  await notificationService.create(
    owner.id,
    title,
    message,
    isEdit ? 'review_updated' : 'new_review',
  )

  try {
    if (isEdit) {
      await emailService.sendReviewUpdatedNotification(owner.email, owner.business_name, rating)
    } else {
      await emailService.sendNewReviewNotification(owner.email, owner.business_name, rating)
    }
  } catch (err) {
    console.error('Business owner review email failed:', err.message)
  }
}

export const reviewService = {
  async create({ businessId, userId, rating, title, content, inviteToken }) {
    const business = await query('SELECT * FROM businesses WHERE id = $1', [businessId])
    if (business.rows.length === 0) throw new AppError('Business not found', 404)

    const existing = await query(
      'SELECT id FROM reviews WHERE business_id = $1 AND user_id = $2',
      [businessId, userId],
    )
    if (existing.rows.length > 0) throw new AppError('You have already reviewed this business', 409)

    const { analysis, shouldPublish } = await aiModerationService.moderateReview({
      title,
      content,
      rating,
      businessName: business.rows[0].name,
    })

    const status = shouldPublish ? 'published' : 'pending'

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

    if (inviteToken) {
      await this.markInvitationReviewed(inviteToken, userId)
    }

    const user = await query('SELECT email, name FROM users WHERE id = $1', [userId])
    await emailService.sendReviewConfirmation(user.rows[0].email, business.rows[0].name)

    if (status === 'published') {
      await emailService.sendReviewPublishedEmail(user.rows[0].email, business.rows[0].name)
      await businessService.updateBusinessStats(businessId)
    }

    await notifyBusinessOwnerAboutReview({
      businessId,
      rating,
      authorName: user.rows[0]?.name,
      status,
      isEdit: false,
    })

    await notificationService.create(
      userId,
      'Review Submitted',
      `Your review for ${business.rows[0].name} is ${status}.`,
      'review_submitted',
    )

    return { review, aiAnalysis: analysis }
  },

  async update(reviewId, userId, { rating, title, content }) {
    const existing = await query('SELECT * FROM reviews WHERE id = $1 AND user_id = $2', [reviewId, userId])
    if (existing.rows.length === 0) throw new AppError('Review not found', 404)

    const business = await query('SELECT name FROM businesses WHERE id = $1', [existing.rows[0].business_id])
    const nextRating = rating ?? existing.rows[0].rating
    const { analysis, shouldPublish } = await aiModerationService.moderateReview({
      title: title ?? existing.rows[0].title,
      content: content ?? existing.rows[0].content,
      rating: nextRating,
      businessName: business.rows[0].name,
    })

    const status = shouldPublish ? 'published' : 'pending'

    const result = await query(
      `UPDATE reviews SET
        rating = COALESCE($1, rating), title = COALESCE($2, title), content = COALESCE($3, content),
        status = $4, ai_risk_score = $5, ai_flags = $6, ai_analysis = $7, updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [rating, title, content, status, analysis.riskScore, JSON.stringify(analysis.flags), JSON.stringify(analysis), reviewId],
    )

    await businessService.updateBusinessStats(existing.rows[0].business_id)

    const author = await query('SELECT name FROM users WHERE id = $1', [userId])
    await notifyBusinessOwnerAboutReview({
      businessId: existing.rows[0].business_id,
      rating: nextRating,
      authorName: author.rows[0]?.name,
      status,
      isEdit: true,
    })

    await notificationService.create(
      userId,
      'Review Updated',
      `Your review for ${business.rows[0].name} was updated and is now ${status}.`,
      'review_updated',
    )

    return { review: result.rows[0], aiAnalysis: analysis }
  },

  async getLatest(queryParams) {
    const { page, limit, offset } = paginate(queryParams)
    const result = await query(
      `SELECT r.*, u.name as author_name,
              b.id as business_id, b.name as business_name, b.slug as business_slug,
              b.category as business_category, b.website as business_website, b.logo_url as business_logo
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
      `SELECT r.*, b.name as business_name, b.slug as business_slug, b.website as business_website
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

    const existing = review.rows[0]
    const isEdit = Boolean(existing.business_reply)

    const result = await query(
      `UPDATE reviews SET business_reply = $1, business_reply_at = NOW(), updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [reply, reviewId],
    )

    // Notify customer only on first reply, not when business edits an existing reply
    if (!isEdit) {
      const reviewer = await query('SELECT email FROM users WHERE id = $1', [existing.user_id])
      if (reviewer.rows[0]) {
        await emailService.sendBusinessReplyNotification(reviewer.rows[0].email, existing.business_name)
        await notificationService.create(
          existing.user_id,
          'Business Reply',
          `${existing.business_name} replied to your review.`,
          'business_reply',
        )
      }
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
      `SELECT r.*, u.name as author_name, u.email as author_email, u.id as author_id, b.name as business_name
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

    const baseUrl = (env.PUBLIC_SITE_URL || 'http://localhost:5173').replace(/\/$/, '')
    const inviteUrl = `${baseUrl}/review-invite/${token}`
    await emailService.sendReviewInvitation(email, business.rows[0].name, inviteUrl)

    return result.rows[0]
  },

  async getInvitationByToken(token) {
    const result = await query(
      `SELECT i.id, i.email, i.token, i.status, i.sent_at, i.reviewed_at,
              b.id as business_id, b.name as business_name, b.slug as business_slug,
              b.logo_url as business_logo, b.category as business_category
       FROM review_invitations i
       JOIN businesses b ON b.id = i.business_id
       WHERE i.token = $1`,
      [token],
    )
    if (result.rows.length === 0) throw new AppError('Invitation not found or expired', 404)
    const invite = result.rows[0]
    if (invite.status === 'expired') throw new AppError('This invitation has expired', 410)
    return invite
  },

  async markInvitationReviewed(token, userId) {
    if (!token) return
    await query(
      `UPDATE review_invitations
       SET status = 'reviewed', reviewed_at = NOW()
       WHERE token = $1 AND status = 'pending'`,
      [token],
    )
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
