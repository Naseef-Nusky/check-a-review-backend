-- Check A Review — SEO meta columns + optional seed data
-- Run against your Postgres DB, e.g.:
--   psql "%DATABASE_URL%" -f scripts/import-seo-meta.sql
-- Or from check-a-review-backend:
--   npm run db:import-seo

-- ── Business page SEO (CRM editable) ─────────────────────────────────────
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS seo_title VARCHAR(255);
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS seo_description TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS seo_keywords TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS seo_extra_tags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── Site-wide / homepage SEO (CRM Settings) ──────────────────────────────
ALTER TABLE website_settings ADD COLUMN IF NOT EXISTS seo_title VARCHAR(255);
ALTER TABLE website_settings ADD COLUMN IF NOT EXISTS seo_description TEXT;
ALTER TABLE website_settings ADD COLUMN IF NOT EXISTS seo_keywords TEXT;
ALTER TABLE website_settings ADD COLUMN IF NOT EXISTS seo_extra_tags JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Seed homepage SEO if empty (brand + review search phrases)
UPDATE website_settings
SET
  seo_title = COALESCE(
    NULLIF(TRIM(seo_title), ''),
    'Check A Review | Trusted customer reviews & business ratings'
  ),
  seo_description = COALESCE(
    NULLIF(TRIM(seo_description), ''),
    'Check A Review — read verified customer reviews, compare business ratings, and find companies you can trust. Search company reviews and business reviews in one place.'
  ),
  seo_keywords = COALESCE(
    NULLIF(TRIM(seo_keywords), ''),
    'check a review, checkareview, customer reviews, company reviews, business reviews, check reviews, trusted reviews'
  ),
  seo_extra_tags = CASE
    WHEN seo_extra_tags IS NULL OR seo_extra_tags = '[]'::jsonb THEN
      '[{"name":"robots","content":"index, follow"}]'::jsonb
    ELSE seo_extra_tags
  END,
  updated_at = NOW()
WHERE id IN (SELECT id FROM website_settings ORDER BY updated_at DESC NULLS LAST, id ASC LIMIT 1);

-- Example: set SEO for a business by slug (edit slug / copy for more businesses)
-- UPDATE businesses
-- SET
--   seo_title = 'Nexxo Digital Reviews | Check A Review',
--   seo_description = 'Read verified Nexxo Digital customer reviews on Check A Review. Ratings, feedback, and company reputation.',
--   seo_keywords = 'nexxo digital reviews, nexxo digital, check a review nexxo',
--   seo_extra_tags = '[{"name":"robots","content":"index, follow"}]'::jsonb,
--   updated_at = NOW()
-- WHERE slug = 'nexxo-digital';
