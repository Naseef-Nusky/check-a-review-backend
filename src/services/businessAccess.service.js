import { query } from '../db/pool.js'
import { AppError } from '../utils/helpers.js'

let membersTableReady = false

export async function ensureBusinessMembersTable() {
  if (membersTableReady) return

  await query(`
    CREATE TABLE IF NOT EXISTS business_members (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      email VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'admin', 'member')),
      status VARCHAR(20) NOT NULL DEFAULT 'invited'
        CHECK (status IN ('active', 'invited', 'disabled')),
      invite_token VARCHAR(255) UNIQUE,
      invited_by UUID REFERENCES users(id) ON DELETE SET NULL,
      invited_at TIMESTAMPTZ DEFAULT NOW(),
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (business_id, email)
    )
  `)

  await query(`
    DROP INDEX IF EXISTS business_members_one_active_user
  `)

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS business_members_one_active_user_per_business
    ON business_members (business_id, user_id)
    WHERE user_id IS NOT NULL AND status = 'active'
  `)

  await query(`
    INSERT INTO business_members (business_id, user_id, email, role, status, accepted_at)
    SELECT b.id, b.user_id, LOWER(u.email), 'owner', 'active', NOW()
    FROM businesses b
    JOIN users u ON u.id = b.user_id
    WHERE NOT EXISTS (
      SELECT 1 FROM business_members m
      WHERE m.business_id = b.id AND m.role = 'owner' AND m.status = 'active'
    )
    ON CONFLICT (business_id, email) DO NOTHING
  `)

  membersTableReady = true
}

export async function ensureOwnerMembership(businessId, userId, email) {
  await ensureBusinessMembersTable()
  await query(
    `INSERT INTO business_members (business_id, user_id, email, role, status, accepted_at)
     VALUES ($1, $2, LOWER($3), 'owner', 'active', NOW())
     ON CONFLICT (business_id, email) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           role = 'owner',
           status = 'active',
           accepted_at = COALESCE(business_members.accepted_at, NOW()),
           updated_at = NOW()`,
    [businessId, userId, email],
  )
}

export async function getBusinessMembership(businessId, userId) {
  await ensureBusinessMembersTable()

  const owner = await query(
    `SELECT b.id as business_id, b.user_id, u.email, 'owner'::text as role, 'active'::text as status
     FROM businesses b
     JOIN users u ON u.id = b.user_id
     WHERE b.id = $1 AND b.user_id = $2`,
    [businessId, userId],
  )
  if (owner.rows[0]) {
    await ensureOwnerMembership(businessId, userId, owner.rows[0].email)
    return { ...owner.rows[0], isOwner: true }
  }

  const member = await query(
    `SELECT m.*, (m.role = 'owner') as is_owner
     FROM business_members m
     WHERE m.business_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [businessId, userId],
  )
  if (!member.rows[0]) return null

  return {
    ...member.rows[0],
    isOwner: member.rows[0].role === 'owner',
  }
}

export async function assertBusinessAccess(businessId, userId) {
  const membership = await getBusinessMembership(businessId, userId)
  if (!membership) throw new AppError('Business not found or access denied', 403)
  return membership
}

export async function assertBusinessOwner(businessId, userId) {
  const membership = await assertBusinessAccess(businessId, userId)
  if (!membership.isOwner && membership.role !== 'owner') {
    throw new AppError('Only the business owner can do this', 403)
  }

  const owner = await query('SELECT id FROM businesses WHERE id = $1 AND user_id = $2', [
    businessId,
    userId,
  ])
  if (owner.rows.length === 0) {
    throw new AppError('Only the business owner can do this', 403)
  }
  return membership
}

export async function getBusinessForUser(userId) {
  await ensureBusinessMembersTable()

  const owned = await query(
    `SELECT b.*, 'owner'::text as member_role, true as is_owner
     FROM businesses b
     WHERE b.user_id = $1
     ORDER BY b.created_at ASC
     LIMIT 1`,
    [userId],
  )
  if (owned.rows[0]) {
    const business = owned.rows[0]
    const emailResult = await query('SELECT email FROM users WHERE id = $1', [userId])
    if (emailResult.rows[0]?.email) {
      await ensureOwnerMembership(business.id, userId, emailResult.rows[0].email)
    }
    return business
  }

  const member = await query(
    `SELECT b.*, m.role as member_role, false as is_owner
     FROM business_members m
     JOIN businesses b ON b.id = m.business_id
     WHERE m.user_id = $1 AND m.status = 'active'
     ORDER BY m.accepted_at ASC NULLS LAST, m.created_at ASC
     LIMIT 1`,
    [userId],
  )
  if (!member.rows[0]) throw new AppError('Business not found', 404)
  return member.rows[0]
}
