import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'
import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { AppError, slugify, omitPassword } from '../utils/helpers.js'
import { emailService } from './email.service.js'
import {
  assertStrongPassword,
  bumpTokenVersion,
  createResetToken,
  createVerificationCode,
  ensureTokenVersionColumn,
  hashSecret,
} from '../utils/session.js'

const googleClient = env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(env.GOOGLE_CLIENT_ID)
  : null

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      tv: Number(user.token_version || 0),
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN },
  )
}

async function ensureGoogleAuthColumns() {
  await query('ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL')
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255)')
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT')
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_google_id_key'
      ) THEN
        ALTER TABLE users ADD CONSTRAINT users_google_id_key UNIQUE (google_id);
      END IF;
    END $$;
  `)
}

let googleColumnsReady = false
async function readyGoogleColumns() {
  if (googleColumnsReady) return
  await ensureGoogleAuthColumns()
  googleColumnsReady = true
}

async function ensureEmailRoleSeparation() {
  // Allow the same email on a customer account and a business account.
  await query(`
    DO $$
    DECLARE
      constraint_name text;
    BEGIN
      SELECT conname INTO constraint_name
      FROM pg_constraint
      WHERE conrelid = 'users'::regclass
        AND contype = 'u'
        AND pg_get_constraintdef(oid) = 'UNIQUE (email)'
      LIMIT 1;

      IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', constraint_name);
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'users'::regclass
          AND conname = 'users_email_role_key'
      ) THEN
        ALTER TABLE users ADD CONSTRAINT users_email_role_key UNIQUE (email, role);
      END IF;
    END $$;
  `)
}

async function ensurePendingRegistrations() {
  await query(`
    CREATE TABLE IF NOT EXISTS pending_registrations (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL CHECK (role IN ('customer', 'business')),
      category VARCHAR(255),
      website TEXT,
      phone VARCHAR(50),
      description TEXT,
      token VARCHAR(255) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (email, role)
    )
  `)

  // Remove unfinished accounts from the old flow (created before verify).
  await query(`
    DELETE FROM users
    WHERE email_verified = FALSE
      AND google_id IS NULL
      AND role IN ('customer', 'business')
  `)
}

let emailRoleReady = false
async function readyAccountSeparation() {
  if (emailRoleReady) return
  await ensureEmailRoleSeparation()
  await ensurePendingRegistrations()
  await ensureTokenVersionColumn()
  emailRoleReady = true
}

async function storePendingRegistration({
  email,
  passwordHash,
  name,
  role,
  category,
  website,
  phone,
  description,
}) {
  const code = createVerificationCode()
  await query(
    `INSERT INTO pending_registrations
       (email, password_hash, name, role, category, website, phone, description, token, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() + INTERVAL '15 minutes', NOW())
     ON CONFLICT (email, role) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       name = EXCLUDED.name,
       category = EXCLUDED.category,
       website = EXCLUDED.website,
       phone = EXCLUDED.phone,
       description = EXCLUDED.description,
       token = EXCLUDED.token,
       expires_at = EXCLUDED.expires_at,
       updated_at = NOW()`,
    [
      email,
      passwordHash,
      name,
      role,
      category || null,
      website || null,
      phone || null,
      description || null,
      hashSecret(code),
    ],
  )
  await emailService.sendVerificationEmail(email, name, code)
  return code
}

async function createBusinessForUser(user, { category, website, phone, description }) {
  const { businessService } = await import('./business.service.js')
  await businessService.ensureBusinessStatusColumn()

  let businessCategory = 'General'
  if (category) {
    const { categoryService } = await import('./category.service.js')
    businessCategory = await categoryService.validateSubcategoryName(category)
  }

  const existingBiz = await query('SELECT id FROM businesses WHERE user_id = $1', [user.id])
  if (existingBiz.rows.length > 0) return

  const bizResult = await query(
    `INSERT INTO businesses (user_id, name, slug, category, email, website, phone, description, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending') RETURNING *`,
    [
      user.id,
      user.name,
      slugify(user.name),
      businessCategory,
      user.email,
      website || null,
      phone || null,
      description || null,
    ],
  )
  await query(`INSERT INTO subscriptions (business_id, plan) VALUES ($1, 'free')`, [
    bizResult.rows[0].id,
  ])

  const { ensureOwnerMembership } = await import('./businessAccess.service.js')
  await ensureOwnerMembership(bizResult.rows[0].id, user.id, user.email)

  const { notificationService } = await import('./notification.service.js')
  await notificationService.notifyCrmStaff(
    'New business pending approval',
    `${bizResult.rows[0].name} signed up and is waiting for listing approval.`,
    'pending_business',
    `/pending-businesses`,
  )

  return bizResult.rows[0]
}

export const authService = {
  async register({ email, password, name, role, category, website, phone, description }) {
    await readyAccountSeparation()
    const emailLower = String(email || '').trim().toLowerCase()
    const accountRole = role === 'business' ? 'business' : 'customer'
    const trimmedName = String(name || '').trim()
    assertStrongPassword(password)

    const existing = await query('SELECT id FROM users WHERE email = $1 AND role = $2', [
      emailLower,
      accountRole,
    ])
    if (existing.rows.length > 0) {
      throw new AppError(
        accountRole === 'business'
          ? 'A business account with this email already exists. Please log in to the business portal.'
          : 'A reviewer account with this email already exists. Please log in instead.',
        409,
        'EMAIL_EXISTS',
      )
    }

    const passwordHash = await bcrypt.hash(password, 12)
    await storePendingRegistration({
      email: emailLower,
      passwordHash,
      name: trimmedName,
      role: accountRole,
      category,
      website,
      phone,
      description,
    })

    return {
      requiresEmailVerification: true,
      email: emailLower,
      role: accountRole,
      message: 'We sent a 6-digit verification code to your email. Your account will be created after you verify.',
    }
  },

  async login({ email, password, role }) {
    await readyGoogleColumns()
    await readyAccountSeparation()

    const emailLower = String(email || '').trim().toLowerCase()
    // customer/business portals always send role. CRM login omits role.
    const isPortalRole = role === 'business' || role === 'customer'

    let user
    if (isPortalRole) {
      const result = await query('SELECT * FROM users WHERE email = $1 AND role = $2', [
        emailLower,
        role,
      ])
      user = result.rows[0]
    } else {
      const result = await query(
        `SELECT * FROM users
         WHERE email = $1 AND role IN ('super_admin', 'admin', 'viewer')
         ORDER BY CASE role
           WHEN 'super_admin' THEN 0
           WHEN 'admin' THEN 1
           ELSE 2
         END
         LIMIT 1`,
        [emailLower],
      )
      user = result.rows[0]
    }

    if (!user) {
      if (isPortalRole) {
        const pending = await query(
          'SELECT id FROM pending_registrations WHERE email = $1 AND role = $2',
          [emailLower, role],
        )
        if (pending.rows[0]) {
          throw new AppError(
            'Please verify your email with the 6-digit code to finish creating your account.',
            403,
            'EMAIL_NOT_VERIFIED',
          )
        }
      }
      throw new AppError('Invalid email or password', 401)
    }

    if (!user.password_hash) {
      throw new AppError('Invalid email or password', 401)
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) throw new AppError('Invalid email or password', 401)

    if (!user.email_verified) {
      throw new AppError(
        'This account is not verified. Please complete email verification or register again.',
        403,
        'EMAIL_NOT_VERIFIED',
      )
    }

    const token = signToken(user)
    return { user: omitPassword(user), token }
  },

  async loginWithGoogle(idToken) {
    if (!googleClient || !env.GOOGLE_CLIENT_ID) {
      throw new AppError('Google sign-in is not configured on the server', 503)
    }
    if (!idToken) throw new AppError('Google credential is required', 400)

    await readyGoogleColumns()
    await readyAccountSeparation()

    let ticket
    try {
      ticket = await googleClient.verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      })
    } catch {
      throw new AppError('Invalid Google sign-in token', 401)
    }

    const payload = ticket.getPayload()
    if (!payload?.email || !payload.sub) {
      throw new AppError('Google account email is required', 400)
    }
    if (payload.email_verified === false) {
      throw new AppError('Google email is not verified', 400)
    }

    const email = payload.email.toLowerCase()
    const googleId = payload.sub
    const name = payload.name || email.split('@')[0]

    // Google sign-in is for reviewer (customer) accounts only.
    let existing = await query(
      `SELECT * FROM users
       WHERE google_id = $1 OR (email = $2 AND role = 'customer')
       LIMIT 1`,
      [googleId, email],
    )
    let user = existing.rows[0]

    if (user) {
      if (user.role !== 'customer') {
        throw new AppError('Please use email login for this account type', 403)
      }
      if (!user.google_id) {
        await query(
          `UPDATE users SET google_id = $1, email_verified = TRUE, updated_at = NOW() WHERE id = $2`,
          [googleId, user.id],
        )
        user = { ...user, google_id: googleId, email_verified: true }
      }
    } else {
      const created = await query(
        `INSERT INTO users (email, password_hash, google_id, name, role, email_verified)
         VALUES ($1, NULL, $2, $3, 'customer', TRUE)
         RETURNING *`,
        [email, googleId, name],
      )
      user = created.rows[0]
      await query('DELETE FROM pending_registrations WHERE email = $1 AND role = $2', [
        email,
        'customer',
      ])
    }

    const token = signToken(user)
    return { user: omitPassword(user), token }
  },

  async verifyEmail({ email, code, role }) {
    await readyAccountSeparation()
    const normalizedEmail = String(email || '').trim().toLowerCase()
    const normalizedCode = String(code || '').replace(/\s+/g, '')
    const accountRole = role === 'business' ? 'business' : role === 'customer' ? 'customer' : null

    if (!normalizedEmail || !/^\d{6}$/.test(normalizedCode)) {
      throw new AppError('Enter your email and the 6-digit verification code', 400)
    }

    const pendingParams = [normalizedEmail, hashSecret(normalizedCode)]
    let pendingRoleFilter = ''
    if (accountRole) {
      pendingRoleFilter = ' AND role = $3'
      pendingParams.push(accountRole)
    }

    const pending = await query(
      `SELECT * FROM pending_registrations
       WHERE email = $1 AND token = $2 AND expires_at > NOW()${pendingRoleFilter}`,
      pendingParams,
    )

    if (pending.rows.length > 0) {
      const row = pending.rows[0]

      const already = await query('SELECT id FROM users WHERE email = $1 AND role = $2', [
        row.email,
        row.role,
      ])
      if (already.rows.length > 0) {
        await query('DELETE FROM pending_registrations WHERE id = $1', [row.id])
        throw new AppError('An account with this email already exists. Please log in.', 409, 'EMAIL_EXISTS')
      }

      const created = await query(
        `INSERT INTO users (email, password_hash, name, role, email_verified)
         VALUES ($1, $2, $3, $4, TRUE)
         RETURNING *`,
        [row.email, row.password_hash, row.name, row.role],
      )
      const user = created.rows[0]

      if (user.role === 'business') {
        await createBusinessForUser(user, {
          category: row.category,
          website: row.website,
          phone: row.phone,
          description: row.description,
        })
      }

      await query('DELETE FROM pending_registrations WHERE id = $1', [row.id])

      return {
        message: 'Email verified. Your account has been created.',
        user: omitPassword(user),
        token: signToken(user),
      }
    }

    // Legacy path for any leftover unverified user + token rows.
    const legacyParams = [normalizedEmail, hashSecret(normalizedCode)]
    let roleFilter = ''
    if (accountRole) {
      roleFilter = ' AND u.role = $3'
      legacyParams.push(accountRole)
    }

    const result = await query(
      `SELECT evt.*, u.id as uid
       FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE u.email = $1 AND evt.token = $2 AND evt.expires_at > NOW()${roleFilter}`,
      legacyParams,
    )
    if (result.rows.length === 0) {
      throw new AppError('Invalid or expired verification code', 400)
    }

    const legacy = result.rows[0]
    await query('UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1', [
      legacy.uid,
    ])
    await query('DELETE FROM email_verification_tokens WHERE user_id = $1', [legacy.uid])

    const userResult = await query('SELECT * FROM users WHERE id = $1', [legacy.uid])
    const user = userResult.rows[0]
    return {
      message: 'Email verified successfully',
      user: omitPassword(user),
      token: signToken(user),
    }
  },

  async resendVerificationCode(email, role) {
    await readyAccountSeparation()
    const normalizedEmail = String(email || '').trim().toLowerCase()
    if (!normalizedEmail) throw new AppError('Email is required', 400)

    const accountRole = role === 'business' ? 'business' : 'customer'

    const existingUser = await query(
      'SELECT id, email_verified FROM users WHERE email = $1 AND role = $2',
      [normalizedEmail, accountRole],
    )
    if (existingUser.rows[0]?.email_verified) {
      return { message: 'This email is already verified. You can log in.' }
    }

    const pending = await query(
      'SELECT * FROM pending_registrations WHERE email = $1 AND role = $2',
      [normalizedEmail, accountRole],
    )
    if (pending.rows.length === 0) {
      return { message: 'If a signup is in progress for this email, a new code has been sent' }
    }

    const row = pending.rows[0]
    const code = createVerificationCode()
    await query(
      `UPDATE pending_registrations
       SET token = $1, expires_at = NOW() + INTERVAL '15 minutes', updated_at = NOW()
       WHERE id = $2`,
      [hashSecret(code), row.id],
    )
    await emailService.sendVerificationEmail(row.email, row.name, code)
    return { message: 'A new verification code has been sent' }
  },

  async forgotPassword(email, role) {
    await readyAccountSeparation()
    const emailLower = String(email || '').trim().toLowerCase()
    let userId = null
    let resetBaseUrl = env.PUBLIC_SITE_URL

    if (role === 'crm') {
      const result = await query(
        `SELECT id FROM users
         WHERE email = $1 AND role IN ('super_admin', 'admin', 'viewer')
         ORDER BY CASE role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
         LIMIT 1`,
        [emailLower],
      )
      userId = result.rows[0]?.id || null
      resetBaseUrl = env.ADMIN_PORTAL_URL
    } else {
      const accountRole = role === 'business' ? 'business' : 'customer'
      const result = await query('SELECT id FROM users WHERE email = $1 AND role = $2', [
        emailLower,
        accountRole,
      ])
      userId = result.rows[0]?.id || null
      resetBaseUrl = accountRole === 'business' ? env.BUSINESS_PORTAL_URL : env.PUBLIC_SITE_URL
    }

    if (!userId) {
      return { message: 'If the email exists, a reset link has been sent' }
    }

    const token = createResetToken()
    await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId])
    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [userId, hashSecret(token)],
    )
    await emailService.sendPasswordResetEmail(emailLower, token, resetBaseUrl)
    return { message: 'If the email exists, a reset link has been sent' }
  },

  async resetPassword(token, newPassword) {
    assertStrongPassword(newPassword)
    const result = await query(
      `SELECT * FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW()`,
      [hashSecret(token)],
    )
    if (result.rows.length === 0) throw new AppError('Invalid or expired reset token', 400)

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      passwordHash,
      result.rows[0].user_id,
    ])
    await bumpTokenVersion(result.rows[0].user_id)
    await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [result.rows[0].user_id])
    return { message: 'Password reset successfully' }
  },

  async changePassword(userId, currentPassword, newPassword) {
    assertStrongPassword(newPassword)
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [userId])
    if (result.rows.length === 0) throw new AppError('User not found', 404)

    const { password_hash: passwordHash } = result.rows[0]
    if (passwordHash) {
      if (!currentPassword) throw new AppError('Current password is required', 400)
      const valid = await bcrypt.compare(currentPassword, passwordHash)
      if (!valid) throw new AppError('Current password is incorrect', 401)
    }

    const nextHash = await bcrypt.hash(newPassword, 12)
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      nextHash,
      userId,
    ])
    await bumpTokenVersion(userId)
    return { message: 'Password updated successfully' }
  },

  async getProfile(userId) {
    await readyGoogleColumns()
    const result = await query('SELECT * FROM users WHERE id = $1', [userId])
    if (result.rows.length === 0) throw new AppError('User not found', 404)
    return omitPassword(result.rows[0])
  },

  async updateProfile(userId, { name, bio, avatar_url, avatarUrl }) {
    await readyGoogleColumns()
    const nextAvatar =
      avatarUrl !== undefined ? avatarUrl : avatar_url !== undefined ? avatar_url : undefined

    const result = await query(
      `UPDATE users SET
         name = COALESCE($1, name),
         bio = COALESCE($2, bio),
         avatar_url = CASE WHEN $4 THEN $3 ELSE avatar_url END,
         updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name ?? null, bio ?? null, nextAvatar ?? null, nextAvatar !== undefined, userId],
    )
    return omitPassword(result.rows[0])
  },

  async updateAvatar(userId, avatarUrl) {
    await readyGoogleColumns()
    const result = await query(
      `UPDATE users SET avatar_url = $1, updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [avatarUrl, userId],
    )
    if (result.rows.length === 0) throw new AppError('User not found', 404)
    return omitPassword(result.rows[0])
  },

  async deleteAccount(userId) {
    const existing = await query(
      `SELECT id, role FROM users WHERE id = $1`,
      [userId],
    )
    if (existing.rows.length === 0) throw new AppError('User not found', 404)
    if (existing.rows[0].role !== 'customer') {
      throw new AppError('Only customer accounts can be deleted here', 403)
    }
    await query('DELETE FROM users WHERE id = $1', [userId])
    return { message: 'Your account has been deleted' }
  },
}
