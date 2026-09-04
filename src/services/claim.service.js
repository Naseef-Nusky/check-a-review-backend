import bcrypt from 'bcryptjs'
import { query } from '../db/pool.js'
import { AppError } from '../utils/helpers.js'
import { createResetToken, hashSecret, assertStrongPassword } from '../utils/session.js'
import { ensureOwnerMembership, ensureBusinessMembersTable } from './businessAccess.service.js'
import { emailService } from './email.service.js'
import { notificationService } from './notification.service.js'
import { env } from '../config/env.js'

const CLAIM_STATUSES = [
  'pending',
  'under_review',
  'needs_info',
  'approved',
  'rejected',
]

const VERIFY_STATUSES = ['pending', 'verified', 'failed', 'not_provided']

let claimTablesReady = false

export async function ensureClaimTables() {
  if (claimTablesReady) return

  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS claimed BOOLEAN NOT NULL DEFAULT false`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS verified_contact BOOLEAN NOT NULL DEFAULT false`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS verified_identity BOOLEAN NOT NULL DEFAULT false`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS verified_ownership BOOLEAN NOT NULL DEFAULT false`)
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`)

  await query(`
    CREATE TABLE IF NOT EXISTS business_claims (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      full_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(50),
      job_title VARCHAR(255),
      relationship VARCHAR(255),
      verification_info TEXT,
      password_hash TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'under_review', 'needs_info', 'approved', 'rejected')),
      email_verified BOOLEAN NOT NULL DEFAULT false,
      email_verified_at TIMESTAMPTZ,
      email_verify_token_hash VARCHAR(255),
      email_verify_expires_at TIMESTAMPTZ,
      contact_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (contact_status IN ('pending', 'verified', 'failed', 'not_provided')),
      ownership_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (ownership_status IN ('pending', 'verified', 'failed', 'not_provided')),
      identity_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (identity_status IN ('pending', 'verified', 'failed', 'not_provided')),
      other_status VARCHAR(20) NOT NULL DEFAULT 'not_provided'
        CHECK (other_status IN ('pending', 'verified', 'failed', 'not_provided')),
      admin_notes TEXT,
      reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS business_ownership_history (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      claim_id UUID REFERENCES business_claims(id) ON DELETE SET NULL,
      event_type VARCHAR(50) NOT NULL,
      from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      from_email VARCHAR(255),
      to_email VARCHAR(255),
      note TEXT,
      performed_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS business_claim_attachments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      claim_id UUID NOT NULL REFERENCES business_claims(id) ON DELETE CASCADE,
      original_name VARCHAR(255) NOT NULL,
      stored_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100),
      size_bytes INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  await query(`
    CREATE INDEX IF NOT EXISTS business_claims_business_id_idx ON business_claims (business_id)
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS business_claims_status_idx ON business_claims (status)
  `)

  // Do not auto-flip claimed=true here — that re-claims businesses after manual unclaim.
  // Claimed is set only via claim approval, CRM create, or listing publish.

  claimTablesReady = true
}

function publicSiteOrigin() {
  return String(env.PUBLIC_SITE_URL || 'https://checkareview.com').replace(/\/$/, '')
}

function businessPortalOrigin() {
  return String(env.BUSINESS_PORTAL_URL || env.PUBLIC_SITE_URL || 'https://business.checkareview.com').replace(
    /\/$/,
    '',
  )
}

function mapClaim(row) {
  if (!row) return null
  return {
    id: row.id,
    businessId: row.business_id,
    businessName: row.business_name,
    businessSlug: row.business_slug,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    jobTitle: row.job_title,
    relationship: row.relationship,
    verificationInfo: row.verification_info,
    status: row.status,
    emailVerified: Boolean(row.email_verified),
    emailVerifiedAt: row.email_verified_at,
    contactStatus: row.contact_status,
    ownershipStatus: row.ownership_status,
    identityStatus: row.identity_status,
    otherStatus: row.other_status,
    adminNotes: row.admin_notes,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function recordHistory({
  businessId,
  claimId = null,
  eventType,
  fromUserId = null,
  toUserId = null,
  fromEmail = null,
  toEmail = null,
  note = null,
  performedBy = null,
}) {
  await query(
    `INSERT INTO business_ownership_history
      (business_id, claim_id, event_type, from_user_id, to_user_id, from_email, to_email, note, performed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [businessId, claimId, eventType, fromUserId, toUserId, fromEmail, toEmail, note, performedBy],
  )
}

async function getClaimRow(claimId) {
  const result = await query(
    `SELECT c.*, b.name as business_name, b.slug as business_slug
     FROM business_claims c
     JOIN businesses b ON b.id = c.business_id
     WHERE c.id = $1`,
    [claimId],
  )
  return result.rows[0] || null
}

async function listAttachments(claimId) {
  const result = await query(
    `SELECT id, claim_id, original_name, stored_name, mime_type, size_bytes, created_at
     FROM business_claim_attachments
     WHERE claim_id = $1
     ORDER BY created_at ASC`,
    [claimId],
  )
  return result.rows.map((row) => ({
    id: row.id,
    claimId: row.claim_id,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    url: `/api/admin/claims/attachments/${row.id}`,
  }))
}

async function saveAttachments(claimId, files = []) {
  const list = Array.isArray(files) ? files : []
  for (const file of list) {
    if (!file?.filename) continue
    await query(
      `INSERT INTO business_claim_attachments
        (claim_id, original_name, stored_name, mime_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        claimId,
        String(file.originalname || file.filename).slice(0, 255),
        file.filename,
        file.mimetype || null,
        Number(file.size) || null,
      ],
    )
  }
}

export const claimService = {
  async ensureReady() {
    await ensureClaimTables()
    await ensureBusinessMembersTable()
  },

  async markBusinessClaimed(businessId, { when = new Date() } = {}) {
    await ensureClaimTables()
    await query(
      `UPDATE businesses
       SET claimed = true,
           claimed_at = COALESCE(claimed_at, $2),
           updated_at = NOW()
       WHERE id = $1`,
      [businessId, when],
    )
  },

  async submitClaim(businessIdOrSlug, data = {}, files = []) {
    await this.ensureReady()

    const businessResult = await query(
      `SELECT b.* FROM businesses b
       WHERE (b.slug = $1 OR b.id::text = $1) AND b.status = 'published'`,
      [businessIdOrSlug],
    )
    const business = businessResult.rows[0]
    if (!business) throw new AppError('Business not found', 404)
    if (business.claimed) {
      throw new AppError('This business profile has already been claimed', 400)
    }

    const fullName = String(data.fullName || data.full_name || '').trim()
    const email = String(data.email || '')
      .trim()
      .toLowerCase()
    const phone = String(data.phone || '').trim()
    const jobTitle = String(data.jobTitle || data.job_title || '').trim()
    const relationship = String(data.relationship || '').trim()
    const verificationInfo = String(data.verificationInfo || data.verification_info || '').trim()
    const password = data.password
    const attachments = Array.isArray(files) ? files : []

    if (!fullName) throw new AppError('Full name is required', 400)
    if (!email || !email.includes('@')) throw new AppError('A valid email is required', 400)
    if (!phone) throw new AppError('Phone number is required', 400)
    if (!jobTitle) throw new AppError('Job title / position is required', 400)
    if (!relationship) throw new AppError('Relationship with the business is required', 400)
    if (!verificationInfo) throw new AppError('Verification information is required', 400)
    assertStrongPassword(password)
    if (attachments.length > 5) {
      throw new AppError('You can upload up to 5 attachments', 400)
    }

    const openClaim = await query(
      `SELECT id FROM business_claims
       WHERE business_id = $1 AND status IN ('pending', 'under_review', 'needs_info')
       LIMIT 1`,
      [business.id],
    )
    if (openClaim.rows[0]) {
      throw new AppError('A claim request is already in progress for this business', 400)
    }

    const emailOpen = await query(
      `SELECT id FROM business_claims
       WHERE LOWER(email) = $1 AND status IN ('pending', 'under_review', 'needs_info')
       LIMIT 1`,
      [email],
    )
    if (emailOpen.rows[0]) {
      throw new AppError('You already have an open claim request with this email', 400)
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const token = createResetToken()
    const tokenHash = hashSecret(token)
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000)

    const hasOwnershipHints = /owner|director|founder|ceo|propriet/i.test(`${relationship} ${verificationInfo}`)
    const result = await query(
      `INSERT INTO business_claims
        (business_id, full_name, email, phone, job_title, relationship, verification_info,
         password_hash, status, email_verify_token_hash, email_verify_expires_at,
         contact_status, ownership_status, identity_status, other_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10,
               'pending', $11, 'pending', 'pending')
       RETURNING *`,
      [
        business.id,
        fullName,
        email,
        phone,
        jobTitle,
        relationship,
        verificationInfo,
        passwordHash,
        tokenHash,
        expiresAt,
        hasOwnershipHints ? 'pending' : 'pending',
      ],
    )

    const claim = result.rows[0]
    await saveAttachments(claim.id, attachments)

    await recordHistory({
      businessId: business.id,
      claimId: claim.id,
      eventType: 'claim_submitted',
      toEmail: email,
      note: `${fullName} submitted a claim request${attachments.length ? ` with ${attachments.length} attachment(s)` : ''}`,
    })

    const verifyUrl = `${publicSiteOrigin()}/claim/verify?token=${encodeURIComponent(token)}`
    await emailService.sendClaimVerificationEmail(email, fullName, business.name, verifyUrl)

    await notificationService.notifyCrmStaff(
      'New business claim request',
      `${fullName} requested to claim ${business.name}`,
      'business_claim',
      '/claims',
    )

    return {
      id: claim.id,
      status: claim.status,
      emailVerified: false,
      attachmentCount: attachments.length,
      message: 'Claim request created. Please verify your email to continue.',
    }
  },

  async verifyClaimEmail(token) {
    await this.ensureReady()
    const tokenHash = hashSecret(token)
    const result = await query(
      `SELECT c.*, b.name as business_name, b.slug as business_slug
       FROM business_claims c
       JOIN businesses b ON b.id = c.business_id
       WHERE c.email_verify_token_hash = $1`,
      [tokenHash],
    )
    const claim = result.rows[0]
    if (!claim) throw new AppError('Invalid or expired verification link', 400)
    if (claim.email_verified) {
      return {
        success: true,
        alreadyVerified: true,
        businessName: claim.business_name,
        status: claim.status,
      }
    }
    if (claim.email_verify_expires_at && new Date(claim.email_verify_expires_at) < new Date()) {
      throw new AppError('This verification link has expired. Submit a new claim request.', 400)
    }
    if (!['pending', 'under_review', 'needs_info'].includes(claim.status)) {
      throw new AppError('This claim can no longer be verified', 400)
    }

    await query(
      `UPDATE business_claims
       SET email_verified = true,
           email_verified_at = NOW(),
           email_verify_token_hash = NULL,
           status = CASE WHEN status = 'pending' THEN 'under_review' ELSE status END,
           updated_at = NOW()
       WHERE id = $1`,
      [claim.id],
    )

    await recordHistory({
      businessId: claim.business_id,
      claimId: claim.id,
      eventType: 'email_verified',
      toEmail: claim.email,
      note: 'Claimant verified their email',
    })

    await notificationService.notifyCrmStaff(
      'Claim email verified',
      `${claim.full_name} verified email for ${claim.business_name}`,
      'business_claim',
      '/claims',
    )

    return {
      success: true,
      businessName: claim.business_name,
      status: claim.status === 'pending' ? 'under_review' : claim.status,
    }
  },

  async listClaims({ status } = {}) {
    await this.ensureReady()
    const params = []
    let where = ''
    if (status && CLAIM_STATUSES.includes(status)) {
      params.push(status)
      where = `WHERE c.status = $${params.length}`
    }
    const result = await query(
      `SELECT c.*, b.name as business_name, b.slug as business_slug, b.logo_url
       FROM business_claims c
       JOIN businesses b ON b.id = c.business_id
       ${where}
       ORDER BY
         CASE c.status
           WHEN 'under_review' THEN 0
           WHEN 'needs_info' THEN 1
           WHEN 'pending' THEN 2
           ELSE 3
         END,
         c.created_at DESC`,
      params,
    )
    const claims = result.rows.map((row) => ({
      ...mapClaim(row),
      logoUrl: row.logo_url,
    }))
    for (const claim of claims) {
      claim.attachments = await listAttachments(claim.id)
    }
    return claims
  },

  async getClaim(claimId) {
    await this.ensureReady()
    const row = await getClaimRow(claimId)
    if (!row) throw new AppError('Claim request not found', 404)
    return {
      ...mapClaim(row),
      attachments: await listAttachments(claimId),
    }
  },

  async getAttachmentFile(attachmentId) {
    await this.ensureReady()
    const result = await query(
      `SELECT a.*, c.id as claim_id
       FROM business_claim_attachments a
       JOIN business_claims c ON c.id = a.claim_id
       WHERE a.id = $1`,
      [attachmentId],
    )
    const row = result.rows[0]
    if (!row) throw new AppError('Attachment not found', 404)
    return {
      id: row.id,
      originalName: row.original_name,
      storedName: row.stored_name,
      mimeType: row.mime_type || 'application/octet-stream',
      sizeBytes: row.size_bytes,
    }
  },

  async updateClaimVerification(claimId, data = {}, adminUserId = null) {
    await this.ensureReady()
    const claim = await getClaimRow(claimId)
    if (!claim) throw new AppError('Claim request not found', 404)

    const next = {
      contact_status: data.contactStatus || data.contact_status || claim.contact_status,
      ownership_status: data.ownershipStatus || data.ownership_status || claim.ownership_status,
      identity_status: data.identityStatus || data.identity_status || claim.identity_status,
      other_status: data.otherStatus || data.other_status || claim.other_status,
      admin_notes: data.adminNotes !== undefined ? data.adminNotes : claim.admin_notes,
    }

    for (const key of ['contact_status', 'ownership_status', 'identity_status', 'other_status']) {
      if (!VERIFY_STATUSES.includes(next[key])) {
        throw new AppError(`Invalid verification status for ${key}`, 400)
      }
    }

    const result = await query(
      `UPDATE business_claims
       SET contact_status = $1,
           ownership_status = $2,
           identity_status = $3,
           other_status = $4,
           admin_notes = $5,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        next.contact_status,
        next.ownership_status,
        next.identity_status,
        next.other_status,
        next.admin_notes,
        claimId,
      ],
    )

    await recordHistory({
      businessId: claim.business_id,
      claimId,
      eventType: 'verification_updated',
      note: 'Admin updated verification statuses',
      performedBy: adminUserId,
    })

    return mapClaim({ ...result.rows[0], business_name: claim.business_name, business_slug: claim.business_slug })
  },

  async reviewClaim(claimId, action, adminUserId, { notes } = {}) {
    await this.ensureReady()
    const claim = await getClaimRow(claimId)
    if (!claim) throw new AppError('Claim request not found', 404)
    if (['approved', 'rejected'].includes(claim.status)) {
      throw new AppError('This claim has already been closed', 400)
    }

    if (action === 'request_info') {
      await query(
        `UPDATE business_claims
         SET status = 'needs_info',
             admin_notes = COALESCE($1, admin_notes),
             reviewed_by = $2,
             reviewed_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [notes || null, adminUserId, claimId],
      )
      await recordHistory({
        businessId: claim.business_id,
        claimId,
        eventType: 'info_requested',
        note: notes || 'Admin requested more information',
        performedBy: adminUserId,
      })
      await emailService.sendClaimNeedsInfoEmail(claim.email, claim.full_name, claim.business_name, notes)
      return this.getClaim(claimId)
    }

    if (action === 'reject') {
      await query(
        `UPDATE business_claims
         SET status = 'rejected',
             admin_notes = COALESCE($1, admin_notes),
             reviewed_by = $2,
             reviewed_at = NOW(),
             updated_at = NOW()
         WHERE id = $3`,
        [notes || null, adminUserId, claimId],
      )
      await recordHistory({
        businessId: claim.business_id,
        claimId,
        eventType: 'claim_rejected',
        note: notes || 'Claim rejected',
        performedBy: adminUserId,
      })
      await emailService.sendClaimRejectedEmail(claim.email, claim.full_name, claim.business_name, notes)
      return this.getClaim(claimId)
    }

    if (action !== 'approve') {
      throw new AppError('Action must be approve, reject, or request_info', 400)
    }

    if (!claim.email_verified) {
      throw new AppError('Claimant must verify their email before approval', 400)
    }

    const business = (
      await query(`SELECT * FROM businesses WHERE id = $1`, [claim.business_id])
    ).rows[0]
    if (!business) throw new AppError('Business not found', 404)
    if (business.claimed) {
      throw new AppError('This business is already claimed', 400)
    }

    let userId = claim.user_id
    const existingUser = await query(
      `SELECT * FROM users WHERE LOWER(email) = $1 AND role = 'business' LIMIT 1`,
      [claim.email],
    )

    if (existingUser.rows[0]) {
      userId = existingUser.rows[0].id
      await query(
        `UPDATE users
         SET name = COALESCE(NULLIF($1, ''), name),
             password_hash = COALESCE($2, password_hash),
             email_verified = TRUE,
             phone = COALESCE(NULLIF($3, ''), phone),
             updated_at = NOW()
         WHERE id = $4`,
        [claim.full_name, claim.password_hash, claim.phone, userId],
      )
    } else {
      const created = await query(
        `INSERT INTO users (email, password_hash, name, role, email_verified, phone)
         VALUES ($1, $2, $3, 'business', TRUE, $4)
         RETURNING id`,
        [claim.email, claim.password_hash, claim.full_name, claim.phone || null],
      )
      userId = created.rows[0].id
    }

    const previousOwnerId = business.user_id
    const previousOwner = await query(`SELECT id, email, name FROM users WHERE id = $1`, [previousOwnerId])

    // Demote previous owner membership if different person
    if (previousOwnerId && previousOwnerId !== userId) {
      await query(
        `UPDATE business_members
         SET role = 'member', status = 'disabled', updated_at = NOW()
         WHERE business_id = $1 AND user_id = $2`,
        [business.id, previousOwnerId],
      )
    }

    await query(`UPDATE businesses SET user_id = $1, updated_at = NOW() WHERE id = $2`, [
      userId,
      business.id,
    ])
    await ensureOwnerMembership(business.id, userId, claim.email)

    const verifiedContact = claim.contact_status === 'verified'
    const verifiedIdentity = claim.identity_status === 'verified'
    const verifiedOwnership = claim.ownership_status === 'verified'

    await query(
      `UPDATE businesses
       SET claimed = true,
           claimed_at = NOW(),
           verified_contact = $2,
           verified_identity = $3,
           verified_ownership = $4,
           email = COALESCE(NULLIF(email, ''), $5),
           phone = COALESCE(NULLIF(phone, ''), $6),
           updated_at = NOW()
       WHERE id = $1`,
      [
        business.id,
        verifiedContact,
        verifiedIdentity,
        verifiedOwnership,
        claim.email,
        claim.phone,
      ],
    )

    await query(
      `UPDATE business_claims
       SET status = 'approved',
           user_id = $1,
           admin_notes = COALESCE($2, admin_notes),
           reviewed_by = $3,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [userId, notes || null, adminUserId, claimId],
    )

    await recordHistory({
      businessId: business.id,
      claimId,
      eventType: 'claim_approved',
      fromUserId: previousOwnerId,
      toUserId: userId,
      fromEmail: previousOwner.rows[0]?.email || null,
      toEmail: claim.email,
      note: notes || 'Claim approved — ownership transferred',
      performedBy: adminUserId,
    })

    await emailService.sendClaimApprovedEmail(
      claim.email,
      claim.full_name,
      claim.business_name,
      `${businessPortalOrigin()}/login`,
    )

    await notificationService.create(
      userId,
      'Business claim approved',
      `${claim.business_name} is now yours on Check A Review.`,
      'business_claim_approved',
    )

    return this.getClaim(claimId)
  },

  async listBusinessUsers(businessId) {
    await this.ensureReady()
    const business = await query(`SELECT id, user_id, claimed FROM businesses WHERE id = $1`, [businessId])
    if (!business.rows[0]) throw new AppError('Business not found', 404)

    await ensureOwnerMembership(
      businessId,
      business.rows[0].user_id,
      (
        await query(`SELECT email FROM users WHERE id = $1`, [business.rows[0].user_id])
      ).rows[0]?.email || 'owner@unknown.local',
    )

    const result = await query(
      `SELECT m.id, m.business_id, m.user_id, m.email, m.role, m.status,
              m.invited_at, m.accepted_at, m.created_at,
              u.name, u.email_verified, u.phone,
              (b.user_id = m.user_id) as is_primary_owner
       FROM business_members m
       LEFT JOIN users u ON u.id = m.user_id
       JOIN businesses b ON b.id = m.business_id
       WHERE m.business_id = $1
       ORDER BY
         CASE WHEN b.user_id = m.user_id THEN 0 WHEN m.role = 'owner' THEN 1 ELSE 2 END,
         m.created_at ASC`,
      [businessId],
    )
    return result.rows
  },

  async addBusinessUser(businessId, data = {}, adminUserId = null) {
    await this.ensureReady()
    const email = String(data.email || '')
      .trim()
      .toLowerCase()
    const name = String(data.name || '').trim()
    const role = ['owner', 'admin', 'member'].includes(data.role) ? data.role : 'member'
    const password = data.password

    if (!email || !email.includes('@')) throw new AppError('Valid email is required', 400)
    if (!name) throw new AppError('Name is required', 400)
    if (role === 'owner') throw new AppError('Use Change Owner to set the primary owner', 400)
    assertStrongPassword(password)

    const business = (await query(`SELECT * FROM businesses WHERE id = $1`, [businessId])).rows[0]
    if (!business) throw new AppError('Business not found', 404)

    let user = (
      await query(`SELECT * FROM users WHERE LOWER(email) = $1 AND role = 'business' LIMIT 1`, [email])
    ).rows[0]

    const passwordHash = await bcrypt.hash(password, 12)
    if (user) {
      await query(
        `UPDATE users SET name = $1, password_hash = $2, email_verified = TRUE, updated_at = NOW() WHERE id = $3`,
        [name, passwordHash, user.id],
      )
    } else {
      const created = await query(
        `INSERT INTO users (email, password_hash, name, role, email_verified)
         VALUES ($1, $2, $3, 'business', TRUE)
         RETURNING *`,
        [email, passwordHash, name],
      )
      user = created.rows[0]
    }

    await query(`DELETE FROM business_members WHERE business_id = $1 AND email = $2`, [businessId, email])
    const member = await query(
      `INSERT INTO business_members (business_id, user_id, email, role, status, accepted_at, invited_by)
       VALUES ($1, $2, $3, $4, 'active', NOW(), $5)
       RETURNING *`,
      [businessId, user.id, email, role, adminUserId],
    )

    await recordHistory({
      businessId,
      eventType: 'user_added',
      toUserId: user.id,
      toEmail: email,
      note: `Added as ${role}`,
      performedBy: adminUserId,
    })

    return member.rows[0]
  },

  async updateBusinessUser(businessId, memberId, data = {}, adminUserId = null) {
    await this.ensureReady()
    const member = (
      await query(`SELECT * FROM business_members WHERE id = $1 AND business_id = $2`, [
        memberId,
        businessId,
      ])
    ).rows[0]
    if (!member) throw new AppError('User not found on this business', 404)

    const business = (await query(`SELECT user_id FROM businesses WHERE id = $1`, [businessId])).rows[0]
    if (business?.user_id === member.user_id && (data.role || data.status === 'disabled')) {
      if (data.role && data.role !== 'owner') {
        throw new AppError('Change the primary owner before demoting this user', 400)
      }
      if (data.status === 'disabled') {
        throw new AppError('Cannot disable the primary owner. Change owner first.', 400)
      }
    }

    const role = data.role && ['owner', 'admin', 'member'].includes(data.role) ? data.role : member.role
    const status =
      data.status && ['active', 'invited', 'disabled'].includes(data.status) ? data.status : member.status

    if (role === 'owner' && member.user_id !== business.user_id) {
      throw new AppError('Use Change Owner to assign the primary owner', 400)
    }

    const result = await query(
      `UPDATE business_members
       SET role = $1, status = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [role, status, memberId],
    )

    await recordHistory({
      businessId,
      eventType: status === 'disabled' ? 'user_disabled' : 'user_updated',
      toUserId: member.user_id,
      toEmail: member.email,
      note: `Role ${role}, status ${status}`,
      performedBy: adminUserId,
    })

    return result.rows[0]
  },

  async removeBusinessUser(businessId, memberId, adminUserId = null) {
    await this.ensureReady()
    const member = (
      await query(`SELECT * FROM business_members WHERE id = $1 AND business_id = $2`, [
        memberId,
        businessId,
      ])
    ).rows[0]
    if (!member) throw new AppError('User not found on this business', 404)

    const business = (await query(`SELECT user_id FROM businesses WHERE id = $1`, [businessId])).rows[0]
    if (business?.user_id === member.user_id) {
      throw new AppError('Cannot remove the primary owner. Change owner first.', 400)
    }

    await query(`DELETE FROM business_members WHERE id = $1`, [memberId])
    await recordHistory({
      businessId,
      eventType: 'user_removed',
      toUserId: member.user_id,
      toEmail: member.email,
      note: 'Removed from business',
      performedBy: adminUserId,
    })
    return { success: true }
  },

  async changeOwner(businessId, newOwnerUserIdOrMemberId, adminUserId = null, { demotePrevious = true } = {}) {
    await this.ensureReady()
    const business = (await query(`SELECT * FROM businesses WHERE id = $1`, [businessId])).rows[0]
    if (!business) throw new AppError('Business not found', 404)

    let newOwner = (
      await query(
        `SELECT m.*, u.name, u.email as user_email
         FROM business_members m
         LEFT JOIN users u ON u.id = m.user_id
         WHERE m.business_id = $1 AND (m.id::text = $2 OR m.user_id::text = $2)`,
        [businessId, String(newOwnerUserIdOrMemberId)],
      )
    ).rows[0]

    if (!newOwner?.user_id) {
      throw new AppError('Select an existing active business user to become owner', 400)
    }
    if (newOwner.status !== 'active') {
      throw new AppError('New owner must be an active user on this business', 400)
    }

    const previousOwnerId = business.user_id
    if (previousOwnerId === newOwner.user_id) {
      return { success: true, message: 'Already the primary owner' }
    }

    const previous = (
      await query(`SELECT id, email, name FROM users WHERE id = $1`, [previousOwnerId])
    ).rows[0]

    if (demotePrevious && previousOwnerId) {
      await query(
        `UPDATE business_members
         SET role = 'member', updated_at = NOW()
         WHERE business_id = $1 AND user_id = $2`,
        [businessId, previousOwnerId],
      )
    }

    await query(`UPDATE businesses SET user_id = $1, claimed = true, claimed_at = COALESCE(claimed_at, NOW()), updated_at = NOW() WHERE id = $2`, [
      newOwner.user_id,
      businessId,
    ])
    await ensureOwnerMembership(businessId, newOwner.user_id, newOwner.email || newOwner.user_email)

    await recordHistory({
      businessId,
      eventType: 'owner_changed',
      fromUserId: previousOwnerId,
      toUserId: newOwner.user_id,
      fromEmail: previous?.email || null,
      toEmail: newOwner.email || newOwner.user_email,
      note: 'Primary owner changed by admin',
      performedBy: adminUserId,
    })

    return {
      success: true,
      owner: {
        userId: newOwner.user_id,
        email: newOwner.email || newOwner.user_email,
        name: newOwner.name,
      },
    }
  },

  async getOwnershipHistory(businessId) {
    await this.ensureReady()
    const result = await query(
      `SELECT h.*,
              fu.name as from_name,
              tu.name as to_name,
              pu.name as performed_by_name
       FROM business_ownership_history h
       LEFT JOIN users fu ON fu.id = h.from_user_id
       LEFT JOIN users tu ON tu.id = h.to_user_id
       LEFT JOIN users pu ON pu.id = h.performed_by
       WHERE h.business_id = $1
       ORDER BY h.created_at DESC`,
      [businessId],
    )
    return result.rows
  },

  async pendingClaimCount() {
    await this.ensureReady()
    const result = await query(
      `SELECT COUNT(*)::int as count
       FROM business_claims
       WHERE status IN ('pending', 'under_review', 'needs_info')`,
    )
    return result.rows[0]?.count || 0
  },
}
