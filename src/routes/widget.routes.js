import { Router } from 'express'
import { businessService } from '../services/business.service.js'
import { reviewService } from '../services/review.service.js'

const router = Router()

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function starRow(rating) {
  const rounded = Math.round(Number(rating) || 0)
  return Array.from({ length: 5 }, (_, index) =>
    `<span style="color:${index < rounded ? '#FF4081' : '#E2E8F0'};font-size:18px;line-height:1;">★</span>`,
  ).join('')
}

/** Uploaded media is stored as a relative path, but an embedded widget needs absolute URLs. */
function absoluteUrl(req, mediaPath) {
  if (!mediaPath) return ''
  if (/^https?:\/\//i.test(mediaPath)) return mediaPath
  const origin = `${req.protocol}://${req.get('host')}`
  return `${origin}${mediaPath.startsWith('/') ? '' : '/'}${mediaPath}`
}

async function loadWidgetData(req, identifier) {
  const business = await businessService.getBySlugOrId(identifier)
  const { reviews } = await reviewService.getByBusiness(business.id, { limit: 5 })

  return {
    businessName: business.name,
    // Absolute so the copied embed snippet works on the customer's own domain,
    // where a relative /api path would resolve against their site instead of ours.
    embedUrl: absoluteUrl(req, `/api/widget/${business.id}`),
    businessLogo: absoluteUrl(req, business.logo_url),
    brandLogo: absoluteUrl(req, '/static/logo-check-a-review.png'),
    averageRating: parseFloat(business.average_rating) || 0,
    reviewCount: business.review_count || 0,
    trustScore: parseFloat(business.trust_score) || 0,
    recentReviews: reviews.map((r) => ({
      rating: r.rating,
      title: r.title,
      author: r.author_name,
      date: r.created_at,
    })),
  }
}

function renderWidgetHtml(data, requestedStyle = 'classic') {
  const style = ['classic', 'compact', 'dark'].includes(requestedStyle) ? requestedStyle : 'classic'
  const dark = style === 'dark'
  const palette = {
    surface: dark ? '#0F172A' : '#FFFFFF',
    surfaceMuted: dark ? '#1E293B' : '#F1F5F9',
    border: dark ? '#334155' : '#E2E8F0',
    text: dark ? '#F8FAFC' : '#0F172A',
    muted: dark ? '#94A3B8' : '#64748B',
    footer: dark ? '#020617' : '#0F172A',
  }
  const markBase =
    `width:44px;height:44px;flex:0 0 44px;border-radius:10px;background:${palette.surfaceMuted};border:1px solid ${palette.border};`

  // Businesses without an uploaded logo fall back to an initial so the layout stays consistent.
  const businessMark = data.businessLogo
    ? `<img src="${escapeHtml(data.businessLogo)}" alt="" style="${markBase}object-fit:contain;padding:4px;box-sizing:border-box;" />`
    : `<div style="${markBase}display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:${palette.muted};">${escapeHtml(
        (data.businessName || 'B').charAt(0).toUpperCase(),
      )}</div>`

  const reviewItems = data.recentReviews.length
    ? data.recentReviews
        .map(
          (review) => `
            <li style="padding:10px 0;border-top:1px solid ${palette.border};">
              <div style="display:flex;align-items:center;gap:8px;">
                <span>${starRow(review.rating)}</span>
                <strong style="font-size:13px;color:${palette.text};">${escapeHtml(review.title || 'Review')}</strong>
              </div>
              <div style="margin-top:4px;font-size:12px;color:${palette.muted};">
                ${escapeHtml(review.author || 'Customer')}
                ${review.date ? ` · ${new Date(review.date).toLocaleDateString()}` : ''}
              </div>
            </li>`,
        )
        .join('')
    : `<li style="padding:12px 0;font-size:13px;color:${palette.muted};">No published reviews yet.</li>`

  const compactContent = `
    <div style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:16px;">
      <div style="display:flex;align-items:center;gap:12px;min-width:0;">
        ${businessMark}
        <div style="min-width:0;">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px;font-weight:700;">${escapeHtml(data.businessName)}</div>
          <div style="margin-top:5px;display:flex;align-items:center;gap:7px;">
            <span>${starRow(data.averageRating)}</span>
            <span style="font-size:13px;font-weight:700;">${data.averageRating.toFixed(1)}</span>
          </div>
        </div>
      </div>
      <div style="flex:0 0 auto;text-align:right;">
        <div style="font-size:20px;font-weight:800;color:#FF4081;">${Math.round(data.trustScore)}%</div>
        <div style="font-size:11px;color:${palette.muted};">${data.reviewCount} review${data.reviewCount === 1 ? '' : 's'}</div>
      </div>
    </div>`

  const fullContent = `
    <div style="padding:16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="display:flex;align-items:flex-start;gap:12px;min-width:0;">
          ${businessMark}
          <div style="min-width:0;">
            <div style="font-size:15px;font-weight:700;">${escapeHtml(data.businessName)}</div>
            <div style="margin-top:6px;display:flex;align-items:center;gap:8px;">
              <span>${starRow(data.averageRating)}</span>
              <span style="font-size:14px;font-weight:700;">${data.averageRating.toFixed(1)}</span>
            </div>
            <div style="margin-top:4px;font-size:12px;color:${palette.muted};">
              ${data.reviewCount} review${data.reviewCount === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:${palette.muted};">Trust score</div>
          <div style="font-size:20px;font-weight:800;color:#FF4081;">${Math.round(data.trustScore)}%</div>
        </div>
      </div>
      <ul style="list-style:none;margin:14px 0 0;padding:0;">
        ${reviewItems}
      </ul>
    </div>`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(data.businessName)} reviews</title>
  </head>
  <body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:transparent;color:${palette.text};">
    <div style="border:1px solid ${palette.border};border-radius:12px;overflow:hidden;background:${palette.surface};">
      ${style === 'compact' ? compactContent : fullContent}
      <div style="background:${palette.footer};padding:10px 16px;display:flex;align-items:center;gap:8px;">
        <span style="font-size:11px;color:#94A3B8;">Powered by</span>
        <img src="${escapeHtml(data.brandLogo)}" alt="Check A Review" style="height:18px;width:auto;display:block;" />
      </div>
    </div>
  </body>
</html>`
}

router.get('/:businessId/data', async (req, res, next) => {
  try {
    const widgetData = await loadWidgetData(req, req.params.businessId)
    res.json({ success: true, data: widgetData })
  } catch (err) {
    next(err)
  }
})

router.get('/:businessId', async (req, res, next) => {
  try {
    const widgetData = await loadWidgetData(req, req.params.businessId)

    if (req.query.format === 'json' || req.accepts(['html', 'json']) === 'json') {
      return res.json({ success: true, data: widgetData })
    }

    res.type('html').send(renderWidgetHtml(widgetData, String(req.query.style || 'classic')))
  } catch (err) {
    next(err)
  }
})

export default router
