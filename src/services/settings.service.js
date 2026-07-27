import { query } from '../db/pool.js'
import { env } from '../config/env.js'

const DEFAULTS = {
  aiModerationEnabled: true,
  autoPublishThreshold: env.AI_AUTO_PUBLISH_THRESHOLD,
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
}
