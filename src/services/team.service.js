import { query } from '../db/pool.js'
import { AppError } from '../utils/helpers.js'
import bcrypt from 'bcryptjs'
import { pricingContentService } from './pricing-content.service.js'
import {
  assertBusinessAccess,
  assertBusinessOwner,
  ensureBusinessMembersTable,
  ensureOwnerMembership,
} from './businessAccess.service.js'

function parseSeatLimit(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!text) return 1
  if (['unlimited', '∞', 'inf', 'infinite'].includes(text)) return Number.POSITIVE_INFINITY
  const match = text.match(/\d+/)
  if (!match) return 1
  const n = parseInt(match[0], 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function formatSeatLimit(limit) {
  return Number.isFinite(limit) ? String(limit) : 'Unlimited'
}

async function getUsersLimitForPlan(planKey) {
  const pricing = await pricingContentService.getBusinessPricingContent()
  const plans = Array.isArray(pricing?.plans) ? pricing.plans : []
  const key = String(planKey || 'free').toLowerCase()

  if (key === 'free') return 1

  const plan = plans.find((item) => String(item.key || '').toLowerCase() === key)
  if (plan?.users) return parseSeatLimit(plan.users)

  const comparison = (pricing?.comparisonSections || [])
    .flatMap((section) => section.rows || [])
    .find((row) => String(row.label || '').trim().toLowerCase() === 'users')
  if (comparison?.values?.[key] != null) return parseSeatLimit(comparison.values[key])

  if (key === 'premium') return Number.POSITIVE_INFINITY
  if (key === 'plus') return 3
  return 1
}

export const teamService = {
  async getSeatInfo(businessId) {
    await ensureBusinessMembersTable()
    const subscription = await query('SELECT plan FROM subscriptions WHERE business_id = $1', [businessId])
    const plan = subscription.rows[0]?.plan || 'free'
    const maxUsers = await getUsersLimitForPlan(plan)

    const countResult = await query(
      `SELECT COUNT(*)::int AS used
       FROM business_members
       WHERE business_id = $1 AND status IN ('active', 'invited')`,
      [businessId],
    )
    const usedSeats = countResult.rows[0]?.used || 0

    return {
      plan,
      maxUsers,
      maxUsersLabel: formatSeatLimit(maxUsers),
      usedSeats,
      remainingSeats: Number.isFinite(maxUsers) ? Math.max(0, maxUsers - usedSeats) : null,
      canInvite: !Number.isFinite(maxUsers) || usedSeats < maxUsers,
    }
  },

  async listMembers(businessId, userId) {
    const membership = await assertBusinessAccess(businessId, userId)
    await ensureBusinessMembersTable()

    const owner = await query(
      `SELECT b.user_id, u.email, u.name
       FROM businesses b
       JOIN users u ON u.id = b.user_id
       WHERE b.id = $1`,
      [businessId],
    )
    if (owner.rows[0]) {
      await ensureOwnerMembership(businessId, owner.rows[0].user_id, owner.rows[0].email)
    }

    const result = await query(
      `SELECT
         m.id,
         m.business_id,
         m.user_id,
         m.email,
         m.role,
         m.status,
         m.invited_at,
         m.accepted_at,
         u.name,
         (b.user_id IS NOT NULL AND b.user_id = m.user_id) as is_account_owner
       FROM business_members m
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN businesses b ON b.id = m.business_id
       WHERE m.business_id = $1 AND m.status IN ('active', 'invited')
       ORDER BY
         CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
         m.created_at ASC`,
      [businessId],
    )

    const seats = await this.getSeatInfo(businessId)
    return {
      members: result.rows,
      seats: {
        ...seats,
        isOwner: Boolean(membership?.isOwner || membership?.role === 'owner'),
      },
    }
  },

  async createMember(businessId, actorUserId, { name, email, password } = {}) {
    await assertBusinessOwner(businessId, actorUserId)
    await ensureBusinessMembersTable()

    const emailLower = String(email || '')
      .trim()
      .toLowerCase()
    const trimmedName = String(name || '').trim()
    if (trimmedName.length < 2) throw new AppError('Enter the user’s name', 400)
    if (!emailLower || !emailLower.includes('@')) {
      throw new AppError('Enter a valid email address', 400)
    }
    if (String(password || '').length < 8) {
      throw new AppError('Password must be at least 8 characters', 400)
    }

    const seats = await this.getSeatInfo(businessId)
    if (!seats.canInvite) {
      throw new AppError(
        `Your ${seats.plan} plan includes ${seats.maxUsersLabel} user${seats.maxUsers === 1 ? '' : 's'}. Upgrade to add more team members.`,
        403,
        'SEAT_LIMIT',
      )
    }

    const existingMember = await query(
      `SELECT id, status FROM business_members WHERE business_id = $1 AND email = $2`,
      [businessId, emailLower],
    )
    if (existingMember.rows[0]?.status === 'active') {
      throw new AppError('This person is already on your team', 409)
    }

    const existingUser = await query(
      `SELECT id FROM users WHERE email = $1 AND role = 'business'`,
      [emailLower],
    )
    if (existingUser.rows[0]) {
      throw new AppError('A business login with this email already exists', 409)
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const createdUser = await query(
      `INSERT INTO users (email, password_hash, name, role, email_verified)
       VALUES ($1, $2, $3, 'business', TRUE)
       RETURNING id, email, name, role`,
      [emailLower, passwordHash, trimmedName],
    )

    // Replace any old invite row for this email
    await query(`DELETE FROM business_members WHERE business_id = $1 AND email = $2`, [
      businessId,
      emailLower,
    ])

    const member = await query(
      `INSERT INTO business_members
        (business_id, user_id, email, role, status, invited_by, invited_at, accepted_at)
       VALUES ($1, $2, $3, 'member', 'active', $4, NOW(), NOW())
       RETURNING *`,
      [businessId, createdUser.rows[0].id, emailLower, actorUserId],
    )

    return {
      ...member.rows[0],
      name: createdUser.rows[0].name,
    }
  },

  async inviteMember(businessId, userId, data = {}) {
    // Owner creates logins directly (no email invite flow).
    return this.createMember(businessId, userId, data)
  },

  async getInviteByToken(token) {
    await ensureBusinessMembersTable()
    const result = await query(
      `SELECT
         m.id,
         m.email,
         m.status,
         m.invite_token,
         b.name as business_name,
         b.id as business_id,
         u.id as existing_user_id
       FROM business_members m
       JOIN businesses b ON b.id = m.business_id
       LEFT JOIN users u ON u.email = m.email AND u.role = 'business'
       WHERE m.invite_token = $1`,
      [token],
    )
    if (!result.rows[0]) throw new AppError('Invitation not found or expired', 404)
    if (result.rows[0].status !== 'invited') {
      throw new AppError('This invitation has already been used', 410)
    }
    return result.rows[0]
  },

  async acceptInvite(token, { userId = null, name = '', password = '' } = {}) {
    await ensureBusinessMembersTable()
    const invite = await this.getInviteByToken(token)

    let memberUserId = userId

    if (memberUserId) {
      const me = await query(`SELECT id, email FROM users WHERE id = $1 AND role = 'business'`, [
        memberUserId,
      ])
      if (!me.rows[0]) throw new AppError('Only a business account can accept this invite', 403)
      if (me.rows[0].email.toLowerCase() !== invite.email.toLowerCase()) {
        throw new AppError('Log in with the invited email address to accept', 403)
      }
    } else if (invite.existing_user_id) {
      throw new AppError('An account already exists for this email. Please log in, then open the invite link again.', 409, 'LOGIN_REQUIRED')
    } else {
      const trimmedName = String(name || '').trim()
      if (trimmedName.length < 2) throw new AppError('Enter your name', 400)
      if (String(password || '').length < 8) {
        throw new AppError('Password must be at least 8 characters', 400)
      }

      const passwordHash = await bcrypt.hash(password, 12)
      const created = await query(
        `INSERT INTO users (email, password_hash, name, role, email_verified)
         VALUES ($1, $2, $3, 'business', TRUE)
         RETURNING id`,
        [invite.email, passwordHash, trimmedName],
      )
      memberUserId = created.rows[0].id
    }

    const elsewhere = await query(
      `SELECT id FROM business_members
       WHERE user_id = $1 AND status = 'active' AND id <> $2`,
      [memberUserId, invite.id],
    )
    if (elsewhere.rows.length > 0) {
      throw new AppError('This account already belongs to another business team', 409)
    }

    const ownsBusiness = await query('SELECT id FROM businesses WHERE user_id = $1', [memberUserId])
    if (ownsBusiness.rows.length > 0 && ownsBusiness.rows[0].id !== invite.business_id) {
      throw new AppError('This account already owns another business', 409)
    }

    const updated = await query(
      `UPDATE business_members
       SET user_id = $1,
           status = 'active',
           invite_token = NULL,
           accepted_at = NOW(),
           updated_at = NOW()
       WHERE id = $2 AND status = 'invited'
       RETURNING *`,
      [memberUserId, invite.id],
    )
    if (!updated.rows[0]) throw new AppError('Invitation not found or expired', 404)

    return {
      member: updated.rows[0],
      businessId: invite.business_id,
      userId: memberUserId,
    }
  },

  async removeMember(businessId, actorUserId, memberId) {
    await assertBusinessOwner(businessId, actorUserId)
    await ensureBusinessMembersTable()

    const member = await query(
      `SELECT m.*, b.user_id as owner_user_id
       FROM business_members m
       JOIN businesses b ON b.id = m.business_id
       WHERE m.id = $1 AND m.business_id = $2`,
      [memberId, businessId],
    )
    if (!member.rows[0]) throw new AppError('Team member not found', 404)

    if (member.rows[0].role === 'owner' || member.rows[0].user_id === member.rows[0].owner_user_id) {
      throw new AppError('You cannot remove the business owner', 400)
    }

    await query('DELETE FROM business_members WHERE id = $1', [memberId])
    return { success: true }
  },
}
