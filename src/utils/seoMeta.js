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

export function cleanBusinessSeoName(name) {
  return String(name || '')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Default page title when CRM field is empty: "{Name} Reviews | Check A Review" */
export function defaultBusinessSeoTitle(name) {
  const clean = cleanBusinessSeoName(name)
  if (!clean) return null
  return `${clean} Reviews | Check A Review`.slice(0, 255)
}

export function defaultBusinessSeoDescription(name, category) {
  const clean = cleanBusinessSeoName(name)
  if (!clean) return null
  const parts = [
    `Review your experience with ${clean} on Check A Review.`,
    category ? `Listed in ${category}.` : null,
    'Read verified customer reviews, ratings, and feedback.',
  ]
  return parts.filter(Boolean).join(' ').slice(0, 320)
}

export function defaultBusinessSeoKeywords(name, category) {
  const clean = cleanBusinessSeoName(name)
  if (!clean) return null
  const bits = [
    `${clean} reviews`,
    `${clean} review`,
    clean,
    category ? `${category} reviews` : null,
    'check a review',
    'checkareview',
  ]
  return [...new Set(bits.filter(Boolean).map((v) => String(v).trim()).filter(Boolean))]
    .join(', ')
    .slice(0, 500)
}

export function isAutoBusinessSeoTitle(title, name) {
  const current = String(title || '').trim()
  if (!current) return true
  return current === defaultBusinessSeoTitle(name)
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
  const autoTitle = defaultBusinessSeoTitle(business?.name)
  const title =
    String(business?.seo_title || '').trim() ||
    fallbackTitle ||
    autoTitle
  const description =
    String(business?.seo_description || '').trim() ||
    fallbackDescription ||
    defaultBusinessSeoDescription(business?.name, business?.category)
  const keywords =
    String(business?.seo_keywords || '').trim() ||
    defaultBusinessSeoKeywords(business?.name, business?.category) ||
    ''
  const extraTags = parseSeoExtraTags(business?.seo_extra_tags)
  return { title, description, keywords, extraTags }
}
