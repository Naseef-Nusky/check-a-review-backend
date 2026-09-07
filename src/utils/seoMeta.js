import { query } from '../db/pool.js'

let businessSeoReady = false
let siteSeoReady = false

export async function ensureBusinessSeoColumns() {
  if (businessSeoReady) return
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS seo_title VARCHAR(255)`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS seo_description TEXT`)
  await query(`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS seo_keywords TEXT`)
  await query(
    `ALTER TABLE businesses ADD COLUMN IF NOT EXISTS seo_extra_tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  )
  businessSeoReady = true
}

export async function ensureSiteSeoColumns() {
  if (siteSeoReady) return
  await query(`ALTER TABLE website_settings ADD COLUMN IF NOT EXISTS seo_title VARCHAR(255)`)
  await query(`ALTER TABLE website_settings ADD COLUMN IF NOT EXISTS seo_description TEXT`)
  await query(`ALTER TABLE website_settings ADD COLUMN IF NOT EXISTS seo_keywords TEXT`)
  await query(
    `ALTER TABLE website_settings ADD COLUMN IF NOT EXISTS seo_extra_tags JSONB NOT NULL DEFAULT '[]'::jsonb`,
  )
  siteSeoReady = true
}

export function parseSeoExtraTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => ({
        name: item?.name ? String(item.name).trim() : '',
        property: item?.property ? String(item.property).trim() : '',
        content: item?.content != null ? String(item.content).trim() : '',
      }))
      .filter((item) => item.content && (item.name || item.property))
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      return parseSeoExtraTags(JSON.parse(value))
    } catch {
      return []
    }
  }
  return []
}

export function normalizeSeoExtraTagsInput(value) {
  if (value === undefined) return undefined
  if (value === null || value === '') return []
  return parseSeoExtraTags(value)
}

export function buildBusinessSeo(business, { fallbackTitle, fallbackDescription } = {}) {
  const title = String(business?.seo_title || '').trim() || fallbackTitle
  const description = String(business?.seo_description || '').trim() || fallbackDescription
  const keywords = String(business?.seo_keywords || '').trim()
  const extraTags = parseSeoExtraTags(business?.seo_extra_tags)
  return { title, description, keywords, extraTags }
}
