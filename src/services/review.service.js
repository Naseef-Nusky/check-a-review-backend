import { v4 as uuidv4 } from 'uuid'
import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { AppError, paginate } from '../utils/helpers.js'
import { aiModerationService } from './aiModeration.service.js'
import { emailService } from './email.service.js'
import { businessService } from './business.service.js'
import { notificationService } from './notification.service.js'
import { assertBusinessAccess } from './businessAccess.service.js'
import { assertInvitationQuota } from './planEntitlements.service.js'

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

/** Run after HTTP response so AI/email do not block submit. */
function runInBackground(label, work) {
  setImmediate(() => {
    Promise.resolve()
      .then(work)
      .catch((err) => {
        console.error(`[review:${label}]`, err?.message || err)
      })
  })
}

async function finalizeNewReview({
  reviewId,
  businessId,
  businessName,
  userId,
  rating,
  title,
  content,
}) {
  const { analysis, shouldPublish } = await aiModerationService.moderateReview({
    title,
    content,
    rating,
    businessName,
    userId,
    businessId,
    excludeReviewId: reviewId,
  })

  const status = shouldPublish ? 'published' : 'pending'
  await query(
    `UPDATE reviews SET
       status = $1,
       ai_risk_score = $2,
       ai_flags = $3,
       ai_analysis = $4,
       updated_at = NOW()
     WHERE id = $5`,
    [
      status,
      analysis.riskScore,
      JSON.stringify(analysis.flags),
      JSON.stringify({ ...analysis, processingStage: 'completed' }),
      reviewId,
    ],
  )

  const user = await query('SELECT email, name FROM users WHERE id = $1', [userId])
  const email = user.rows[0]?.email
  const authorName = user.rows[0]?.name

  const sideEffects = []

  if (email) {
    sideEffects.push(
      emailService.sendReviewConfirmation(email, businessName).catch((err) => {
        console.error('Review confirmation email failed:', err.message)
      }),
    )
  }

  if (status === 'published') {
    if (email) {
      sideEffects.push(
        emailService.sendReviewPublishedEmail(email, businessName).catch((err) => {
          console.error('Review published email failed:', err.message)
        }),
      )
    }
    sideEffects.push(businessService.updateBusinessStats(businessId))
  }

  sideEffects.push(
    notifyBusinessOwnerAboutReview({
      businessId,
      rating,
      authorName,
      status,
      isEdit: false,
    }),
  )

  sideEffects.push(
    notificationService.create(
      userId,
      status === 'published' ? 'Review published' : 'Review submitted for processing',
      status === 'published'
        ? `Your review for ${businessName} passed our checks and is now live.`
        : `Your review for ${businessName} is being processed. Most reviews go live within a few minutes to a few hours after automated checks.`,
      'review_submitted',
    ),
  )

  if (status === 'pending') {
    sideEffects.push(
      notificationService.notifyCrmStaff(
        'New review pending approval',
        `A review for ${businessName} is waiting in the moderation queue.`,
        'pending_review',
        '/flagged',
      ),
    )
  }

  await Promise.all(sideEffects)
}

async function finalizeUpdatedReview({
  reviewId,
  businessId,
  businessName,
  userId,
  rating,
  title,
  content,
}) {
  const { analysis, shouldPublish } = await aiModerationService.moderateReview({
    title,
    content,
    rating,
    businessName,
    userId,
    businessId,
    excludeReviewId: reviewId,
  })

  const status = shouldPublish ? 'published' : 'pending'
  await query(
    `UPDATE reviews SET
      status = $1, ai_risk_score = $2, ai_flags = $3, ai_analysis = $4, updated_at = NOW()
     WHERE id = $5`,
    [
      status,
      analysis.riskScore,
      JSON.stringify(analysis.flags),
      JSON.stringify({ ...analysis, processingStage: 'completed' }),
      reviewId,
    ],
  )

  if (status === 'published') {
    await businessService.updateBusinessStats(businessId)
  }

  const author = await query('SELECT name, email FROM users WHERE id = $1', [userId])

  await Promise.all([
    notifyBusinessOwnerAboutReview({
      businessId,
      rating,
      authorName: author.rows[0]?.name,
      status,
      isEdit: true,
    }),
    status === 'published' && author.rows[0]?.email
      ? emailService.sendReviewPublishedEmail(author.rows[0].email, businessName).catch((err) => {
          console.error('Review published email failed:', err.message)
        })
      : Promise.resolve(),
    notificationService.create(
      userId,
      status === 'published' ? 'Review updated and published' : 'Review update in processing',
      status === 'published'
        ? `Your updated review for ${businessName} passed our checks and is live.`
        : `Your updated review for ${businessName} is being processed again before it goes live.`,
      'review_updated',
    ),
  ])
}

export const reviewService = {
  async create({ businessId, userId, rating, title, content, inviteToken }) {
    const business = await query('SELECT * FROM businesses WHERE id = $1', [businessId])
    if (business.rows.length === 0) throw new AppError('Business not found', 404)
    await businessService.ensureBusinessStatusColumn()
    if (business.rows[0].status && business.rows[0].status !== 'published') {
      throw new AppError('This business is not accepting public reviews yet', 403)
    }

    const existing = await query(
      'SELECT id FROM reviews WHERE business_id = $1 AND user_id = $2',
      [businessId, userId],
    )
    if (existing.rows.length > 0) throw new AppError('You have already reviewed this business', 409)

    // Save immediately as pending; AI + emails run in the background.
    const inserted = await query(
      `INSERT INTO reviews (business_id, user_id, rating, title, content, status, ai_risk_score, ai_flags, ai_analysis)
       VALUES ($1, $2, $3, $4, $5, 'pending', NULL, '[]'::jsonb, $6::jsonb) RETURNING *`,
      [
        businessId,
        userId,
        rating,
        title,
        content,
        JSON.stringify({ processingStage: 'queued' }),
      ],
    )
    const review = inserted.rows[0]

    if (inviteToken) {
      await this.markInvitationReviewed(inviteToken, userId)
    }

    const businessName = business.rows[0].name
    runInBackground('finalize-create', () =>
      finalizeNewReview({
        reviewId: review.id,
        businessId,
        businessName,
        userId,
        rating,
        title,
        content,
      }),
    )

    return { review, processing: true }
  },

  async update(reviewId, userId, { rating, title, content }) {
    const existing = await query('SELECT * FROM reviews WHERE id = $1 AND user_id = $2', [
      reviewId,
      userId,
    ])
    if (existing.rows.length === 0) throw new AppError('Review not found', 404)

    const business = await query('SELECT name FROM businesses WHERE id = $1', [
      existing.rows[0].business_id,
    ])
    const nextRating = rating ?? existing.rows[0].rating
    const nextTitle = title ?? existing.rows[0].title
    const nextContent = content ?? existing.rows[0].content
    const businessId = existing.rows[0].business_id

    // Re-enter processing: unpublish while checks run in the background.
    const result = await query(
      `UPDATE reviews SET
         rating = COALESCE($1, rating),
         title = COALESCE($2, title),
         content = COALESCE($3, content),
         status = 'pending',
         ai_analysis = jsonb_set(COALESCE(ai_analysis, '{}'::jsonb), '{processingStage}', '"queued"', true),
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [rating, title, content, reviewId],
    )
    await businessService.updateBusinessStats(businessId)

    runInBackground('finalize-update', () =>
      finalizeUpdatedReview({
        reviewId,
        businessId,
        businessName: business.rows[0].name,
        userId,
        rating: nextRating,
        title: nextTitle,
        content: nextContent,
      }),
    )

    return { review: result.rows[0], processing: true }
  },

  async getLatest(queryParams) {
    const { page, limit, offset } = paginate(queryParams)
    const result = await query(
      `SELECT r.*, u.name as author_name, u.avatar_url as author_avatar,
              b.id as business_id, b.name as business_name, b.slug as business_slug,
              b.category as business_category, b.website as business_website, b.logo_url as business_logo
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN businesses b ON b.id = r.business_id
       WHERE r.status = 'published' AND b.status = 'published'
       ORDER BY r.created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    )
    const count = await query(
      `SELECT COUNT(*) FROM reviews r
       JOIN businesses b ON b.id = r.business_id
       WHERE r.status = 'published' AND b.status = 'published'`,
    )
    return { reviews: result.rows, total: parseInt(count.rows[0].count, 10), page, limit }
  },

  async getByBusiness(businessId, queryParams) {
    const { page, limit, offset } = paginate(queryParams)
    const result = await query(
      `SELECT r.*, u.name as author_name, u.avatar_url as author_avatar
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
      `SELECT r.*, b.id as business_id, b.name as business_name
       FROM reviews r JOIN businesses b ON b.id = r.business_id WHERE r.id = $1`,
      [reviewId],
    )
    if (review.rows.length === 0) throw new AppError('Review not found', 404)
    await assertBusinessAccess(review.rows[0].business_id, userId)

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
    const before = await query('SELECT * FROM reviews WHERE id = $1', [reviewId])
    if (before.rows.length === 0) throw new AppError('Review not found', 404)

    const result = await query(
      `UPDATE reviews SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [status, reviewId],
    )

    await businessService.updateBusinessStats(result.rows[0].business_id)

    const user = await query('SELECT email FROM users WHERE id = $1', [result.rows[0].user_id])
    const business = await query('SELECT name FROM businesses WHERE id = $1', [
      result.rows[0].business_id,
    ])

    if (status === 'published' && user.rows[0] && business.rows[0]) {
      await emailService.sendReviewPublishedEmail(user.rows[0].email, business.rows[0].name)
      await notificationService.create(
        result.rows[0].user_id,
        'Review published',
        `Your review for ${business.rows[0].name} is now live.`,
        'review_published',
      )
    }

    if (status === 'rejected' && user.rows[0] && business.rows[0]) {
      await notificationService.create(
        result.rows[0].user_id,
        'Review not published',
        `Your review for ${business.rows[0].name} did not pass our guidelines and was not published.`,
        'review_rejected',
      )
    }

    return result.rows[0]
  },

  async getFlagged() {
    const result = await query(
      `SELECT r.*, u.name as author_name, u.email as author_email, u.id as author_id, b.name as business_name
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN businesses b ON b.id = r.business_id
       WHERE r.status = 'pending'
       ORDER BY COALESCE(r.ai_risk_score, 0) DESC, r.created_at ASC`,
    )
    return result.rows
  },

  async sendInvitation(businessId, userId, email) {
    await assertBusinessAccess(businessId, userId)
    const business = await query('SELECT * FROM businesses WHERE id = $1', [businessId])
    if (business.rows.length === 0) throw new AppError('Business not found', 404)
    await assertInvitationQuota(businessId)

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
    await assertBusinessAccess(businessId, userId)

    const result = await query(
      'SELECT * FROM review_invitations WHERE business_id = $1 ORDER BY sent_at DESC',
      [businessId],
    )
    return result.rows
  },
}
