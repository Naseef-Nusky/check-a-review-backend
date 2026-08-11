import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import {
  MEDIA_KIND,
  mediaService,
  siteLogoPublicPath,
} from './media.service.js'

const DEFAULTS = {
  aiModerationEnabled: true,
  autoPublishThreshold: env.AI_AUTO_PUBLISH_THRESHOLD,
}

let logoColumnReady = false

async function ensureLogoColumn() {
  if (logoColumnReady) return
  await query('ALTER TABLE website_settings ADD COLUMN IF NOT EXISTS logo_url TEXT')
  logoColumnReady = true
}

function absoluteMediaUrl(mediaPath) {
  if (!mediaPath) return null
  if (/^https?:\/\//i.test(mediaPath)) return mediaPath
  const base = String(env.PUBLIC_API_URL || `http://localhost:${env.PORT}`).replace(/\/$/, '')
  const normalized = mediaPath.startsWith('/') ? mediaPath : `/${mediaPath}`
  return `${base}${normalized}`
}

export const settingsService = {
  async getModerationSettings() {
    const result = await query(
      `SELECT ai_moderation_enabled, auto_publish_threshold
       FROM website_settings
       ORDER BY updated_at DESC NULLS LAST, id ASC
       LIMIT 1`,
    )

    const row = result.rows[0]
    if (!row) return { ...DEFAULTS }

    return {
      aiModerationEnabled: row.ai_moderation_enabled ?? DEFAULTS.aiModerationEnabled,
      autoPublishThreshold: Number(row.auto_publish_threshold ?? DEFAULTS.autoPublishThreshold),
    }
  },

  async getBrandSettings() {
    await ensureLogoColumn()
    const result = await query(
      `SELECT site_name, support_email, logo_url
       FROM website_settings
       ORDER BY updated_at DESC NULLS LAST, id ASC
       LIMIT 1`,
    )
    const row = result.rows[0] || {}
    const siteName = row.site_name || 'Check A Review'
    const stored = await mediaService.getImage(MEDIA_KIND.SITE_LOGO)
    const logoPath = stored
      ? siteLogoPublicPath(new Date(stored.updated_at).getTime())
      : row.logo_url || '/static/logo-check-a-review.png'
    return {
      siteName,
      supportEmail: row.support_email || 'support@checkareview.com',
      logoUrl: absoluteMediaUrl(logoPath),
      logoPath,
    }
  },

  async updateSiteLogoFromUpload({ buffer, mimeType } = {}) {
    await ensureLogoColumn()
    await mediaService.upsertImage({
      kind: MEDIA_KIND.SITE_LOGO,
      mimeType,
      buffer,
    })
    const logoUrl = siteLogoPublicPath()
    return this.updateSiteLogo(logoUrl)
  },

  async updateSiteLogo(logoUrl) {
    await ensureLogoColumn()
    const existing = await query('SELECT id FROM website_settings ORDER BY id ASC LIMIT 1')
    if (existing.rows.length === 0) {
      const created = await query(
        `INSERT INTO website_settings (site_name, support_email, logo_url)
         VALUES ('Check A Review', 'support@checkareview.com', $1)
         RETURNING *`,
        [logoUrl],
      )
      return created.rows[0]
    }

    const result = await query(
      `UPDATE website_settings
       SET logo_url = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [logoUrl, existing.rows[0].id],
    )
    return result.rows[0]
  },

  async removeSiteLogo() {
    await mediaService.deleteImage(MEDIA_KIND.SITE_LOGO)
    return this.updateSiteLogo(null)
  },
}
