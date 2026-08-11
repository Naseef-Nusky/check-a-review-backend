import { query } from '../db/pool.js'
import { AppError } from '../utils/helpers.js'

export const MEDIA_KIND = {
  BUSINESS_LOGO: 'business_logo',
  SITE_LOGO: 'site_logo',
}

const SITE_REF = '00000000-0000-0000-0000-000000000001'

let tableReady = false

export async function ensureStoredImagesTable() {
  if (tableReady) return
  await query(`
    CREATE TABLE IF NOT EXISTS stored_images (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      kind VARCHAR(40) NOT NULL,
      ref_id UUID NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      bytes BYTEA NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (kind, ref_id)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_stored_images_kind_ref ON stored_images(kind, ref_id)`)
  tableReady = true
}

export function businessLogoPublicPath(businessId, version = Date.now()) {
  return `/api/media/businesses/${businessId}/logo?v=${version}`
}

export function siteLogoPublicPath(version = Date.now()) {
  return `/api/media/site/logo?v=${version}`
}

function refFor(kind, refId) {
  if (kind === MEDIA_KIND.SITE_LOGO) return SITE_REF
  if (!refId) throw new AppError('Media reference id is required', 400)
  return refId
}

export const mediaService = {
  async upsertImage({ kind, refId = null, mimeType, buffer }) {
    await ensureStoredImagesTable()
    if (!buffer?.length) throw new AppError('Image data is required', 400)
    if (!mimeType || !String(mimeType).startsWith('image/')) {
      throw new AppError('Invalid image type', 400)
    }

    const resolvedRef = refFor(kind, refId)
    const result = await query(
      `INSERT INTO stored_images (kind, ref_id, mime_type, bytes, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (kind, ref_id)
       DO UPDATE SET mime_type = EXCLUDED.mime_type, bytes = EXCLUDED.bytes, updated_at = NOW()
       RETURNING id, kind, ref_id, mime_type, updated_at, octet_length(bytes) AS byte_length`,
      [kind, resolvedRef, mimeType, buffer],
    )
    return result.rows[0]
  },

  async getImage(kind, refId = null) {
    await ensureStoredImagesTable()
    const resolvedRef = refFor(kind, refId)
    const result = await query(
      `SELECT mime_type, bytes, updated_at
       FROM stored_images
       WHERE kind = $1 AND ref_id = $2
       LIMIT 1`,
      [kind, resolvedRef],
    )
    return result.rows[0] || null
  },

  async deleteImage(kind, refId = null) {
    await ensureStoredImagesTable()
    const resolvedRef = refFor(kind, refId)
    await query(`DELETE FROM stored_images WHERE kind = $1 AND ref_id = $2`, [kind, resolvedRef])
  },
}
