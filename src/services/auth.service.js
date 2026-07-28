import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { AppError, slugify, omitPassword } from '../utils/helpers.js'
import { emailService } from './email.service.js'

const googleClient = env.GOOGLE_CLIENT_ID
  ? new OAuth2Client(env.GOOGLE_CLIENT_ID)
  : null

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
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

export const authService = {
  async register({ email, password, name, role, category, website, phone, description }) {
    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (existing.rows.length > 0) {
      throw new AppError('Email already registered', 409)
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const result = await query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [email.toLowerCase(), passwordHash, name, role],
    )
    const user = result.rows[0]

    const verifyToken = uuidv4()
    await query(
      `INSERT INTO email_verification_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
      [user.id, verifyToken],
    )

    await emailService.sendVerificationEmail(user.email, user.name, verifyToken)

    if (role === 'business') {
      let businessCategory = 'General'
      if (category) {
        const { categoryService } = await import('./category.service.js')
        businessCategory = await categoryService.validateSubcategoryName(category)
      }

      const businessSlug = slugify(name)
      const bizResult = await query(
        `INSERT INTO businesses (user_id, name, slug, category, email, website, phone, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          user.id,
          name,
          businessSlug,
          businessCategory,
          email.toLowerCase(),
          website || null,
          phone || null,
          description || null,
        ],
      )
      await query(
        `INSERT INTO subscriptions (business_id, plan) VALUES ($1, 'free')`,
        [bizResult.rows[0].id],
      )
    }

    const token = signToken(user)
    return { user: omitPassword(user), token }
  },

  async login({ email, password }) {
    await readyGoogleColumns()
    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()])
    const user = result.rows[0]
    if (!user) throw new AppError('Invalid email or password', 401)

    if (!user.password_hash) {
      throw new AppError('This account uses Google sign-in. Please continue with Google.', 401)
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) throw new AppError('Invalid email or password', 401)

    const token = signToken(user)
    return { user: omitPassword(user), token }
  },

  async loginWithGoogle(idToken) {
    if (!googleClient || !env.GOOGLE_CLIENT_ID) {
      throw new AppError('Google sign-in is not configured on the server', 503)
    }
    if (!idToken) throw new AppError('Google credential is required', 400)

    await readyGoogleColumns()

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

    let existing = await query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2 LIMIT 1',
      [googleId, email],
    )
    let user = existing.rows[0]

    if (user) {
      if (user.role === 'admin' || user.role === 'super_admin' || user.role === 'viewer' || user.role === 'business') {
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
    }

    const token = signToken(user)
    return { user: omitPassword(user), token }
  },

  async verifyEmail(token) {
    const result = await query(
      `SELECT evt.*, u.email FROM email_verification_tokens evt
       JOIN users u ON u.id = evt.user_id
       WHERE evt.token = $1 AND evt.expires_at > NOW()`,
      [token],
    )
    if (result.rows.length === 0) throw new AppError('Invalid or expired verification token', 400)

    const { user_id } = result.rows[0]
    await query('UPDATE users SET email_verified = TRUE, updated_at = NOW() WHERE id = $1', [user_id])
    await query('DELETE FROM email_verification_tokens WHERE user_id = $1', [user_id])
    return { message: 'Email verified successfully' }
  },

  async forgotPassword(email) {
    const result = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (result.rows.length === 0) {
      return { message: 'If the email exists, a reset link has been sent' }
    }

    const token = uuidv4()
    await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [result.rows[0].id])
    await query(
      `INSERT INTO password_reset_tokens (user_id, token, expires_at)
       VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [result.rows[0].id, token],
    )
    await emailService.sendPasswordResetEmail(email, token)
    return { message: 'If the email exists, a reset link has been sent' }
  },

  async resetPassword(token, newPassword) {
    const result = await query(
      `SELECT * FROM password_reset_tokens WHERE token = $1 AND expires_at > NOW()`,
      [token],
    )
    if (result.rows.length === 0) throw new AppError('Invalid or expired reset token', 400)

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [
      passwordHash,
      result.rows[0].user_id,
    ])
    await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [result.rows[0].user_id])
    return { message: 'Password reset successfully' }
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
}
