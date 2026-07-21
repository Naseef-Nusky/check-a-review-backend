import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { AppError, slugify, omitPassword } from '../utils/helpers.js'
import { emailService } from './email.service.js'

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN },
  )
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
    const result = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()])
    const user = result.rows[0]
    if (!user) throw new AppError('Invalid email or password', 401)

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) throw new AppError('Invalid email or password', 401)

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
    const result = await query('SELECT * FROM users WHERE id = $1', [userId])
    if (result.rows.length === 0) throw new AppError('User not found', 404)
    return omitPassword(result.rows[0])
  },

  async updateProfile(userId, { name, bio }) {
    const result = await query(
      `UPDATE users SET name = COALESCE($1, name), bio = COALESCE($2, bio), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [name, bio, userId],
    )
    return omitPassword(result.rows[0])
  },
}
