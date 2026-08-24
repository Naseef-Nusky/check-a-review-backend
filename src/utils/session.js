import { createHash, randomInt, randomBytes } from 'crypto'
import { query } from '../db/pool.js'
import { AppError } from './helpers.js'

let tokenVersionReady = false

export async function ensureTokenVersionColumn() {
  if (tokenVersionReady) return
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0`)
  tokenVersionReady = true
}

export function hashSecret(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex')
}

export function createVerificationCode() {
  return String(randomInt(100000, 1000000))
}

export function createResetToken() {
  return randomBytes(32).toString('hex')
}

export async function bumpTokenVersion(userId) {
  await ensureTokenVersionColumn()
  await query(
    `UPDATE users
     SET token_version = COALESCE(token_version, 0) + 1, updated_at = NOW()
     WHERE id = $1`,
    [userId],
  )
}

export function assertStrongPassword(password) {
  if (!password || String(password).length < 8) {
    throw new AppError('Password must be at least 8 characters', 400)
  }
}
