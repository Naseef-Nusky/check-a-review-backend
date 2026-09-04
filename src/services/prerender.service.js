import { query } from '../db/pool.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/helpers.js'
import { businessService } from './business.service.js'

function siteOrigin() {
  return String(process.env.PUBLIC_SITE_URL || env.PUBLIC_SITE_URL || 'https://checkareview.com').replace(
    /\/$/,
    '',
  )
}

function apiOrigin() {
  return String(process.env.PUBLIC_API_URL || env.PUBLIC_API_URL || '').replace(/\/$/, '')
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function absoluteMediaUrl(url) {
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  const api = apiOrigin() || siteOrigin()
  return `${api}${url.startsWith('/') ? '' : '/'}${url}`
}

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function buildJsonLd(business, reviews, pageUrl) {
  const rating = Number(business.average_rating || 0)
  const reviewCount = Number(business.review_count || 0)
  const logo = absoluteMediaUrl(business.logo_url) || undefined

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${pageUrl}#business`,
    name: business.name,
    alternateName: `${business.name} reviews`,
    url: pageUrl,
    description:
      business.description ||
      `Read verified customer reviews and ratings for ${business.name} on Check A Review.`,
    image: logo,
    category: business.category || undefined,
    telephone: business.phone || undefined,
    email: business.email || undefined,
    address: business.address
      ? {
          '@type': 'PostalAddress',
          streetAddress: business.address,
        }
      : undefined,
    sameAs: business.website ? [business.website] : undefined,
  }

  if (reviewCount > 0 && rating > 0) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: Number(rating.toFixed(2)),
      bestRating: 5,
      worstRating: 1,
      ratingCount: reviewCount,
      reviewCount,
    }
  }

  const sample = (reviews || []).slice(0, 10)
  if (sample.length > 0) {
    schema.review = sample.map((r) => ({
      '@type': 'Review',
      author: { '@type': 'Person', name: r.author_name || 'Customer' },
      datePublished: r.created_at || r.updated_at,
      name: r.title || undefined,
      reviewBody: r.content,
      reviewRating: {
        '@type': 'Rating',
        ratingValue: Number(r.rating) || 0,
        bestRating: 5,
        worstRating: 1,
      },
      publisher: {
        '@type': 'Organization',
        name: 'Check A Review',
        url: siteOrigin(),
      },
    }))
  }

  return schema
}

export const prerenderService = {
  async renderBusinessPage(identifier) {
    const business = await businessService.getBySlugOrId(identifier)
    if (!business || business.status !== 'published') {
      throw new AppError('Business not found', 404)
    }

    const reviewsResult = await query(
      `SELECT r.rating, r.title, r.content, r.created_at, r.updated_at, u.name as author_name
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       WHERE r.business_id = $1 AND r.status = 'published'
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [business.id],
    )
    const reviews = reviewsResult.rows

    const origin = siteOrigin()
    const slug = business.slug || business.id
    const pagePath = `/businesses/${slug}`
    const pageUrl = `${origin}${pagePath}`
    const rating = Number(business.average_rating || 0)
    const reviewCount = Number(business.review_count || 0)
    const title = `${business.name} Reviews | Check A Review`
    const description = [
      `${business.name} reviews on Check A Review.`,
      `Read ${reviewCount} verified customer review${reviewCount === 1 ? '' : 's'}.`,
      rating > 0 ? `Average rating ${rating.toFixed(1)} out of 5.` : null,
      business.category ? `Listed in ${business.category}.` : null,
    ]
      .filter(Boolean)
      .join(' ')

    const logo = absoluteMediaUrl(business.logo_url)
    const jsonLd = buildJsonLd(business, reviews, pageUrl)

    const reviewHtml = reviews.length
      ? reviews
          .map((review) => {
            const author = escapeHtml(review.author_name || 'Customer')
            const reviewTitle = escapeHtml(review.title || 'Customer review')
            const body = escapeHtml(review.content || '')
            const stars = Number(review.rating) || 0
            const date = escapeHtml(formatDate(review.created_at))
            return `<article class="review">
  <h3>${reviewTitle}</h3>
  <p class="meta">${author} · ${stars}/5${date ? ` · ${date}` : ''}</p>
  <p>${body}</p>
</article>`
          })
          .join('\n')
      : '<p>No published reviews yet.</p>'

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${escapeHtml(pageUrl)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Check A Review" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(pageUrl)}" />
  ${logo ? `<meta property="og:image" content="${escapeHtml(logo)}" />` : ''}
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f8fafc;color:#0f172a;line-height:1.5}
    main{max-width:720px;margin:0 auto;padding:24px 16px 48px}
    a{color:#db2777}
    .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px;margin-top:16px}
    .review{border-top:1px solid #e2e8f0;padding-top:16px;margin-top:16px}
    .review:first-child{border-top:0;padding-top:0;margin-top:0}
    .meta{color:#64748b;font-size:14px}
    .cta{display:inline-block;margin-top:20px;background:#db2777;color:#fff;text-decoration:none;padding:10px 16px;border-radius:999px;font-weight:600}
  </style>
</head>
<body>
  <main>
    <p><a href="${escapeHtml(origin)}/">Check A Review</a> / Business reviews</p>
    <h1>${escapeHtml(business.name)} Reviews</h1>
    <p>${escapeHtml(description)}</p>
    <div class="card">
      <p><strong>Rating:</strong> ${rating > 0 ? `${rating.toFixed(1)} / 5` : 'No rating yet'}</p>
      <p><strong>Reviews:</strong> ${reviewCount}</p>
      ${business.category ? `<p><strong>Category:</strong> ${escapeHtml(business.category)}</p>` : ''}
      ${business.address ? `<p><strong>Address:</strong> ${escapeHtml(business.address)}</p>` : ''}
      ${business.website ? `<p><strong>Website:</strong> <a href="${escapeHtml(business.website)}">${escapeHtml(business.website)}</a></p>` : ''}
    </div>
    <section class="card">
      <h2>Customer reviews</h2>
      ${reviewHtml}
    </section>
    <a class="cta" href="${escapeHtml(pageUrl)}">Open full interactive profile</a>
  </main>
</body>
</html>`
  },
}
