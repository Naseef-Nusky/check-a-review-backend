/**
 * Trustpilot-style public profile URLs:
 *   /review/www.tesco.com
 * Fallback when no website:
 *   /businesses/{slug}
 */

export function toApexDomain(input) {
  let raw = String(input || '')
    .trim()
    .toLowerCase()
  if (!raw) return ''

  raw = raw.replace(/\s+/g, '')
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`

  try {
    let hostname = new URL(raw).hostname.toLowerCase()
    hostname = hostname.replace(/^www\./, '').replace(/\.$/, '')
    if (!hostname || !hostname.includes('.')) return ''
    return hostname
  } catch {
    return ''
  }
}

/** Public path segment like Trustpilot: www.domain.com */
export function toReviewDomainSegment(input) {
  const apex = toApexDomain(input)
  if (!apex) return ''
  return `www.${apex}`
}

export function businessPublicPath(business) {
  if (!business) return '/search'
  const website = business.website || business.business_website || ''
  const reviewDomain = toReviewDomainSegment(website)
  if (reviewDomain) return `/review/${reviewDomain}`

  const slug = business.slug || business.business_slug
  const id = business.id || business.business_id
  if (slug) return `/businesses/${encodeURIComponent(slug)}`
  if (id) return `/businesses/${encodeURIComponent(id)}`
  return '/search'
}

export function businessPublicUrl(origin, business) {
  const base = String(origin || '').replace(/\/$/, '')
  return `${base}${businessPublicPath(business)}`
}
