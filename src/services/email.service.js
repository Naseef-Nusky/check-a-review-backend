import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sgMail from '@sendgrid/mail'
import { env } from '../config/env.js'
import { settingsService } from './settings.service.js'
import { uploadsRoot } from '../middleware/upload.js'
import { MEDIA_KIND, mediaService } from './media.service.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const publicRoot = path.resolve(__dirname, '../../public')

const hasValidSendGridKey = Boolean(env.SENDGRID_API_KEY && env.SENDGRID_API_KEY.startsWith('SG.'))
const DEFAULT_APP_NAME = 'Check A Review'
const BRAND = '#FF4081'
const BRAND_SOFT = '#FFF1F6'
const SLATE = '#0F172A'
const MUTED = '#64748B'
const BORDER = '#E2E8F0'
const PAGE_BG = '#EEF2F7'
const CARD_BG = '#FFFFFF'
const LOGO_BG = '#0F172A'
const TITLE_BG = '#F8FAFC'
const FOOTER_BG = '#F1F5F9'
const LOGO_CID = 'brandlogo'

if (hasValidSendGridKey) {
  sgMail.setApiKey(env.SENDGRID_API_KEY)
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatEmailDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function formatEmailMoney(amount, currency = 'GBP') {
  const code = String(currency || 'GBP').toUpperCase()
  const cents = Number(amount) || 0
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100)
  } catch {
    return `${code} ${(cents / 100).toFixed(2)}`
  }
}

function sectionCard({ title, body, accent = BRAND_SOFT }) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;border-collapse:collapse;">
      <tr>
        <td bgcolor="${accent}" style="background:${accent};border:1px solid ${BORDER};border-radius:16px;padding:18px;">
          <div style="font-size:15px;font-weight:700;color:${SLATE};margin:0 0 6px 0;">${title}</div>
          <div style="font-size:14px;line-height:1.7;color:${MUTED};margin:0;">${body}</div>
        </td>
      </tr>
    </table>
  `
}

function statCard({ value, label }) {
  return `
    <td width="33.33%" valign="top" style="padding:0 6px 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td align="center" bgcolor="${TITLE_BG}" style="background:${TITLE_BG};border:1px solid ${BORDER};border-radius:14px;padding:16px 10px;">
            <div style="font-size:24px;font-weight:800;color:${SLATE};line-height:1.2;">${value}</div>
            <div style="margin-top:6px;font-size:12px;color:${MUTED};">${label}</div>
          </td>
        </tr>
      </table>
    </td>
  `
}

function isLocalMediaUrl(url = '') {
  return /localhost|127\.0\.0\.1/i.test(String(url))
}

function resolveLogoFilePath(logoPath) {
  if (!logoPath) return null
  if (/^https?:\/\//i.test(logoPath)) return null
  if (String(logoPath).includes('/api/media/')) return null

  const normalized = logoPath.replace(/\\/g, '/')
  if (normalized.startsWith('/uploads/')) {
    return path.join(uploadsRoot, normalized.replace('/uploads/', ''))
  }
  if (normalized.startsWith('/static/')) {
    return path.join(publicRoot, normalized.replace('/static/', ''))
  }
  if (normalized.startsWith('uploads/')) {
    return path.join(uploadsRoot, normalized.replace('uploads/', ''))
  }
  return null
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/png'
}

function bytesToBuffer(bytes) {
  if (!bytes) return null
  if (Buffer.isBuffer(bytes)) return bytes
  if (bytes instanceof Uint8Array) return Buffer.from(bytes)
  if (typeof bytes === 'string') return Buffer.from(bytes, 'base64')
  try {
    return Buffer.from(bytes)
  } catch {
    return null
  }
}

async function loadInlineLogo(logoPath) {
  // Prefer DB-backed site logo first (CRM Settings upload).
  try {
    const image = await mediaService.getImage(MEDIA_KIND.SITE_LOGO)
    const payload = bytesToBuffer(image?.bytes)
    if (payload?.length) {
      return {
        content: payload.toString('base64'),
        type: image.mime_type || 'image/png',
        filename: 'site-logo.png',
        contentId: LOGO_CID,
      }
    }
  } catch (err) {
    console.warn('[Email] Could not load site logo from database:', err.message || err)
  }

  // Fallback for legacy /uploads or /static logo paths.
  const filePath = resolveLogoFilePath(logoPath)
  if (!filePath || !fs.existsSync(filePath)) return null

  return {
    content: fs.readFileSync(filePath).toString('base64'),
    type: mimeFromPath(filePath),
    filename: path.basename(filePath),
    contentId: LOGO_CID,
  }
}

async function renderEmailTemplate({
  eyebrow,
  title,
  intro,
  body,
  primaryCta,
  secondaryCta,
  sections = [],
  stats = [],
  footerNote,
}) {
  const brand = await settingsService.getBrandSettings()
  const appName = brand.siteName || DEFAULT_APP_NAME
  const inlineLogo = await loadInlineLogo(brand.logoPath)
  // Prefer CID so logos work even when PUBLIC_API_URL is localhost.
  // Never fall back to a localhost URL — email clients cannot load it.
  const remoteLogo =
    brand.logoUrl && !isLocalMediaUrl(brand.logoUrl) ? brand.logoUrl : ''
  const logoSrc = inlineLogo ? `cid:${inlineLogo.contentId}` : remoteLogo
  const resolvedEyebrow = eyebrow || appName
  const resolvedFooter =
    footerNote || `This message was sent because of activity on your ${appName} account.`

  if (!inlineLogo && !remoteLogo) {
    console.warn('[Email] No embeddable site logo found — using text brand header')
  }

  const logoBlock = logoSrc
    ? `
      <img
        src="${escapeHtml(logoSrc)}"
        alt="${escapeHtml(appName)}"
        width="200"
        style="display:block;margin:0 auto;width:200px;max-width:86%;height:auto;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;background:${LOGO_BG};"
      />
    `
    : `
      <div style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:.01em;">
        ${escapeHtml(appName)}
      </div>
    `

  const primaryButton = primaryCta
    ? `
      <a href="${primaryCta.href}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px;margin:0 8px 8px 0;">
        ${primaryCta.label}
      </a>
    `
    : ''

  const secondaryButton = secondaryCta
    ? `
      <a href="${secondaryCta.href}" style="display:inline-block;background:${CARD_BG};color:${SLATE};text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px;border:1px solid ${BORDER};margin:0 0 8px 0;">
        ${secondaryCta.label}
      </a>
    `
    : ''

  const statsTable =
    stats.length > 0
      ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;border-collapse:collapse;">
          <tr>
            ${stats.map(statCard).join('')}
          </tr>
        </table>
      `
      : ''

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content="light" />
      <meta name="supported-color-schemes" content="light" />
      <title>${escapeHtml(title)}</title>
    </head>
    <body style="margin:0;padding:0;background:${PAGE_BG};font-family:Arial,Helvetica,sans-serif;color:${SLATE};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${PAGE_BG}" style="background:${PAGE_BG};border-collapse:collapse;">
        <tr>
          <td align="center" style="padding:28px 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;border-collapse:collapse;">
              <tr>
                <td style="padding:0 0 14px 0;font-size:12px;line-height:1.5;color:${MUTED};text-align:center;">
                  ${escapeHtml(appName)}
                </td>
              </tr>
              <tr>
                <td bgcolor="${CARD_BG}" style="background:${CARD_BG};border:1px solid ${BORDER};border-radius:20px;overflow:hidden;">
                  <!-- Brand accent bar -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                    <tr>
                      <td bgcolor="${BRAND}" height="6" style="background:${BRAND};font-size:0;line-height:0;">&nbsp;</td>
                    </tr>
                  </table>

                  <!-- Logo on dark background: wordmark is white / transparent PNG -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${LOGO_BG}" style="background:${LOGO_BG};border-collapse:collapse;">
                    <tr>
                      <td align="center" bgcolor="${LOGO_BG}" style="background:${LOGO_BG};padding:26px 28px;">
                        ${logoBlock}
                      </td>
                    </tr>
                  </table>

                  <!-- Title band -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${TITLE_BG}" style="background:${TITLE_BG};border-top:1px solid ${BORDER};border-bottom:1px solid ${BORDER};border-collapse:collapse;">
                    <tr>
                      <td style="padding:22px 28px;">
                        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:${BRAND};margin:0 0 8px 0;">
                          ${escapeHtml(resolvedEyebrow)}
                        </div>
                        <div style="font-size:28px;line-height:1.25;font-weight:800;color:${SLATE};margin:0;">
                          ${title}
                        </div>
                      </td>
                    </tr>
                  </table>

                  <!-- Body -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${CARD_BG}" style="background:${CARD_BG};border-collapse:collapse;">
                    <tr>
                      <td style="padding:28px;">
                        <div style="font-size:15px;line-height:1.8;color:${MUTED};margin:0;">${intro}</div>
                        <div style="margin-top:14px;font-size:15px;line-height:1.8;color:${SLATE};">${body}</div>
                        ${(primaryButton || secondaryButton) ? `<div style="margin-top:24px;">${primaryButton}${secondaryButton}</div>` : ''}
                        ${statsTable}
                        ${sections.join('')}
                      </td>
                    </tr>
                  </table>

                  <!-- Footer -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${FOOTER_BG}" style="background:${FOOTER_BG};border-top:1px solid ${BORDER};border-collapse:collapse;">
                    <tr>
                      <td style="padding:20px 28px;font-size:12px;line-height:1.7;color:${MUTED};">
                        ${resolvedFooter}<br />
                        If you did not expect this message, you can safely ignore it.
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 8px 0 8px;font-size:11px;line-height:1.6;color:#94A3B8;text-align:center;">
                  © ${new Date().getFullYear()} ${escapeHtml(appName)}. All rights reserved.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `

  return { html, inlineLogo }
}

async function sendViaSendGrid({ to, subject, html, inlineLogo }) {
  if (!hasValidSendGridKey) {
    console.log(`[Email - Dev Mode] To: ${to} | Subject: ${subject}`)
    return
  }

  const message = {
    to,
    from: env.SENDGRID_FROM_EMAIL,
    subject,
    html,
  }

  if (inlineLogo) {
    message.attachments = [
      {
        content: inlineLogo.content,
        filename: inlineLogo.filename || 'site-logo.png',
        type: inlineLogo.type || 'image/png',
        disposition: 'inline',
        content_id: inlineLogo.contentId,
        contentId: inlineLogo.contentId,
      },
    ]
  }

  await sgMail.send(message)
}

async function sendEmail(payload) {
  try {
    return await sendViaSendGrid(payload)
  } catch (err) {
    console.warn(`[Email] Failed to send "${payload.subject}" to ${payload.to}:`, err.message || err)
  }
}

async function appName() {
  const brand = await settingsService.getBrandSettings()
  return brand.siteName || DEFAULT_APP_NAME
}

async function sendTemplatedEmail({ to, subject, template }) {
  const { html, inlineLogo } = await renderEmailTemplate(template)
  await sendEmail({ to, subject, html, inlineLogo })
}

function displayBusinessName(name) {
  const cleaned = String(name || '')
    .replace(/^(free|starter|plus|premium)\s+plan\s+/i, '')
    .trim()
  return cleaned || String(name || 'this business')
}

export const emailService = {
  async sendVerificationEmail(to, name, code) {
    const APP_NAME = await appName()
    await sendTemplatedEmail({
      to,
      subject: `Your ${APP_NAME} verification code`,
      template: {
        eyebrow: `Welcome to ${APP_NAME}`,
        title: 'Confirm your email',
        intro: `Hi ${escapeHtml(name)}, use this code to verify your email address.`,
        body: 'Enter the code on the verification page to activate your account.',
        stats: [{ value: escapeHtml(code), label: 'Verification code' }],
        sections: [
          sectionCard({
            title: 'Code details',
            body: `Your 6-digit code is <strong style="font-size:20px;letter-spacing:4px;color:${SLATE};">${escapeHtml(code)}</strong>. It expires in 15 minutes.`,
          }),
        ],
        footerNote: 'This verification code expires in 15 minutes.',
      },
    })
  },

  async sendPasswordResetEmail(to, token, resetBaseUrl = env.PUBLIC_SITE_URL) {
    const APP_NAME = await appName()
    const base = String(resetBaseUrl || env.PUBLIC_SITE_URL).replace(/\/$/, '')
    const resetUrl = `${base}/reset-password?token=${encodeURIComponent(token)}`
    await sendTemplatedEmail({
      to,
      subject: 'Reset your password',
      template: {
        eyebrow: APP_NAME,
        title: 'Reset your password',
        intro: 'We received a request to reset your password.',
        body: 'Use the button below to choose a new password and get back into your account.',
        primaryCta: { label: 'Create a new password', href: resetUrl },
        footerNote: 'This password reset link expires in 1 hour.',
      },
    })
  },

  async sendReviewConfirmation(to, businessName) {
    await sendTemplatedEmail({
      to,
      subject: 'Review submitted — processing',
      template: {
        eyebrow: 'Review received',
        title: 'Thanks for sharing your experience',
        intro: `Your review for <strong>${escapeHtml(businessName)}</strong> has been submitted successfully.`,
        body: 'It is now in our processing stage, where we run automated checks for spam, guideline issues, and duplicate content. Many reviews go live quickly, while some may take longer if they need an extra check.',
        primaryCta: { label: 'Browse more businesses', href: `${env.PUBLIC_SITE_URL}/search` },
        sections: [
          sectionCard({
            title: 'What we check',
            body: 'We look for suspicious patterns, offensive language, personal information, and duplicate submissions before a review is published.',
          }),
        ],
        footerNote: 'You are receiving this because you submitted a review on Check A Review.',
      },
    })
  },

  async sendReviewPublishedEmail(to, businessName) {
    const APP_NAME = await appName()
    await sendTemplatedEmail({
      to,
      subject: 'Your review has been published',
      template: {
        eyebrow: 'Review published',
        title: 'Your review is now live',
        intro: `Good news. Your review for <strong>${escapeHtml(businessName)}</strong> has passed our checks and is now visible on ${APP_NAME}.`,
        body: 'Thank you for helping other customers make better decisions with honest and useful feedback.',
        primaryCta: { label: 'See latest reviews', href: `${env.PUBLIC_SITE_URL}/reviews` },
        secondaryCta: { label: 'Write another review', href: `${env.PUBLIC_SITE_URL}/search` },
        sections: [
          sectionCard({
            title: 'Keep your review up to date',
            body: 'If your experience changes later, you can come back and edit your review to reflect the latest outcome.',
          }),
        ],
        footerNote: 'This message confirms that your review is now publicly visible on Check A Review.',
      },
    })
  },

  async sendBusinessReplyNotification(to, businessName) {
    await sendTemplatedEmail({
      to,
      subject: `${businessName} replied to your review`,
      template: {
        eyebrow: 'New business reply',
        title: 'A business responded to your review',
        intro: `<strong>${escapeHtml(businessName)}</strong> has posted a reply to your review.`,
        body: 'Open your account to read the response and decide whether you want to update your review.',
        primaryCta: { label: 'Open my reviews', href: `${env.PUBLIC_SITE_URL}/users/reviews` },
        footerNote: 'You are receiving this because a business replied to one of your reviews.',
      },
    })
  },

  async sendNewReviewNotification(to, businessName, rating) {
    await sendTemplatedEmail({
      to,
      subject: `New ${rating}-star review for ${businessName}`,
      template: {
        eyebrow: 'New customer review',
        title: 'You received a new review',
        intro: `A customer just left a <strong>${escapeHtml(rating)}-star</strong> review for <strong>${escapeHtml(businessName)}</strong>.`,
        body: 'Log in to your business dashboard to read the review and post a public reply.',
        primaryCta: { label: 'Reply on dashboard', href: `${env.BUSINESS_PORTAL_URL}/reviews` },
        footerNote: 'You are receiving this because your business received a new review.',
      },
    })
  },

  async sendReviewUpdatedNotification(to, businessName, rating) {
    await sendTemplatedEmail({
      to,
      subject: `A review was updated for ${businessName}`,
      template: {
        eyebrow: 'Review updated',
        title: 'A customer updated their review',
        intro: `A customer updated a <strong>${escapeHtml(rating)}-star</strong> review for <strong>${escapeHtml(businessName)}</strong>.`,
        body: 'You can open your dashboard to view the latest version and decide whether you want to update your reply.',
        primaryCta: { label: 'View updated review', href: `${env.BUSINESS_PORTAL_URL}/reviews` },
        footerNote: 'You are receiving this because a review for your business was edited.',
      },
    })
  },

  async sendReviewInvitation(to, businessName, inviteUrl) {
    const APP_NAME = await appName()
    const name = displayBusinessName(businessName)
    await sendTemplatedEmail({
      to,
      subject: `${name} invites you to leave a review`,
      template: {
        eyebrow: 'Review invitation',
        title: `Share your experience with ${escapeHtml(name)}`,
        intro: `${escapeHtml(name)} invited you to leave a review on ${APP_NAME}.`,
        body: 'If you already have an account, you can log in and write your review right away. If not, you can sign up first and then continue.',
        primaryCta: { label: 'Write a review', href: inviteUrl },
        footerNote: 'You are receiving this because a business invited you to leave a review on Check A Review.',
      },
    })
  },

  async sendTeamInvitation(to, { businessName, inviterName, inviteUrl, memberName }) {
    const APP_NAME = await appName()
    const greeting = memberName
      ? `Hi ${escapeHtml(memberName)},`
      : 'Hi,'
    await sendTemplatedEmail({
      to,
      subject: `${inviterName} invited you to ${businessName} on ${APP_NAME}`,
      template: {
        eyebrow: 'Team invitation',
        title: `Join ${escapeHtml(businessName)}`,
        intro: `${greeting} <strong>${escapeHtml(inviterName)}</strong> invited you to the ${escapeHtml(businessName)} business dashboard on ${APP_NAME}.`,
        body: 'Accept the invitation to create your login (or sign in with this email) and help manage reviews for this business.',
        primaryCta: { label: 'Accept invitation', href: inviteUrl },
        footerNote: 'You are receiving this because a business owner invited you to their Check A Review team.',
      },
    })
  },

  async sendSubscriptionConfirmation(to, plan, extras = {}) {
    const nextBill = extras.nextBillingDate ? formatEmailDate(extras.nextBillingDate) : null
    await sendTemplatedEmail({
      to,
      subject: `Subscription confirmed - ${plan} plan`,
      template: {
        eyebrow: 'Subscription active',
        title: `${escapeHtml(plan)} plan confirmed`,
        intro: `Your <strong>${escapeHtml(plan)}</strong> subscription is now active and renews monthly.`,
        body: nextBill
          ? `Thank you for choosing Check A Review. Your next monthly renewal is on <strong>${escapeHtml(nextBill)}</strong>.`
          : 'Thank you for choosing Check A Review. Your account is ready to use with the features included in your plan. Billing renews automatically each month.',
        primaryCta: { label: 'Open business dashboard', href: `${env.BUSINESS_PORTAL_URL}/dashboard` },
      },
    })
  },

  async sendSubscriptionRenewed(to, plan, extras = {}) {
    const nextBill = extras.nextBillingDate ? formatEmailDate(extras.nextBillingDate) : null
    const paid = extras.amount != null ? formatEmailMoney(extras.amount, extras.currency) : null
    await sendTemplatedEmail({
      to,
      subject: `Your ${plan} plan has been renewed`,
      template: {
        eyebrow: 'Monthly renewal',
        title: `${escapeHtml(plan)} plan renewed`,
        intro: `We successfully renewed your <strong>${escapeHtml(plan)}</strong> subscription for another month.`,
        body: [
          paid ? `Amount charged: <strong>${escapeHtml(paid)}</strong>.` : '',
          nextBill ? `Your next monthly renewal is on <strong>${escapeHtml(nextBill)}</strong>.` : '',
          'No action is needed. Your plan features stay active.',
        ]
          .filter(Boolean)
          .join(' '),
        stats: [
          ...(paid ? [{ value: paid, label: 'Renewal charge' }] : []),
          ...(nextBill ? [{ value: nextBill, label: 'Next renewal' }] : []),
        ],
        primaryCta: { label: 'View subscription', href: `${env.BUSINESS_PORTAL_URL}/subscription` },
      },
    })
  },

  async sendRenewalReminder(to, plan, extras = {}) {
    const nextBill = extras.nextBillingDate ? formatEmailDate(extras.nextBillingDate) : 'soon'
    await sendTemplatedEmail({
      to,
      subject: `Your ${plan} plan renews ${typeof nextBill === 'string' ? nextBill : 'soon'}`,
      template: {
        eyebrow: 'Upcoming renewal',
        title: 'Your monthly subscription renews soon',
        intro: `Your <strong>${escapeHtml(plan)}</strong> plan will automatically renew on <strong>${escapeHtml(String(nextBill))}</strong>.`,
        body: 'Square will charge the card on file for the next month. You can review or change your plan in the business portal before the renewal date.',
        primaryCta: { label: 'Manage subscription', href: `${env.BUSINESS_PORTAL_URL}/subscription` },
      },
    })
  },

  async sendPaymentFailed(to, plan, extras = {}) {
    await sendTemplatedEmail({
      to,
      subject: `Payment failed for your ${plan} plan`,
      template: {
        eyebrow: 'Action needed',
        title: 'Monthly renewal payment failed',
        intro: `We could not collect the monthly renewal for your <strong>${escapeHtml(plan)}</strong> plan.`,
        body: extras.detail
          ? escapeHtml(extras.detail)
          : 'Your subscription is marked past due. Please retry checkout or update your payment method so your plan features stay available.',
        primaryCta: { label: 'Retry payment', href: `${env.BUSINESS_PORTAL_URL}/subscription` },
      },
    })
  },

  async sendPaymentReceipt(to, amount, plan, extras = {}) {
    const paid = formatEmailMoney(amount, extras.currency)
    await sendTemplatedEmail({
      to,
      subject: extras.renewal ? `Renewal receipt - ${plan} plan` : 'Payment receipt',
      template: {
        eyebrow: extras.renewal ? 'Monthly renewal' : 'Payment successful',
        title: extras.renewal ? 'Your renewal payment was received' : 'Your payment was received',
        intro: extras.renewal
          ? `We successfully processed the monthly renewal for the <strong>${escapeHtml(plan)}</strong> plan.`
          : `We successfully processed your payment for the <strong>${escapeHtml(plan)}</strong> plan.`,
        body: `Amount paid: <strong>${escapeHtml(paid)}</strong>.`,
        stats: [{ value: paid, label: extras.renewal ? 'Renewed' : 'Paid' }],
        primaryCta: { label: 'View subscription', href: `${env.BUSINESS_PORTAL_URL}/subscription` },
      },
    })
  },

  async sendBusinessApprovedEmail(to, businessName) {
    await sendTemplatedEmail({
      to,
      subject: `${businessName} is now live on Check A Review`,
      template: {
        eyebrow: 'Listing approved',
        title: 'Your business is live',
        intro: `Good news. <strong>${escapeHtml(businessName)}</strong> has been approved and is now visible on Check A Review.`,
        body: 'Customers can find your profile, leave reviews, and see your replies. Open your dashboard to invite customers and keep your listing up to date.',
        primaryCta: { label: 'Open business dashboard', href: `${env.BUSINESS_PORTAL_URL}/dashboard` },
        footerNote: 'You are receiving this because your business listing was approved.',
      },
    })
  },

  async sendBusinessRejectedEmail(to, businessName) {
    await sendTemplatedEmail({
      to,
      subject: `Update needed for ${businessName}`,
      template: {
        eyebrow: 'Listing not approved',
        title: 'Your listing needs attention',
        intro: `We reviewed <strong>${escapeHtml(businessName)}</strong> and could not approve it for public listing yet.`,
        body: 'Please review your company details in the business portal and contact support if you need help getting approved.',
        primaryCta: { label: 'Update company profile', href: `${env.BUSINESS_PORTAL_URL}/profile` },
        footerNote: 'You are receiving this because your business listing was reviewed by our team.',
      },
    })
  },
}
