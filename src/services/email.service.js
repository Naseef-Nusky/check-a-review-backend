import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sgMail from '@sendgrid/mail'
import { env } from '../config/env.js'
import { settingsService } from './settings.service.js'
import { uploadsRoot } from '../middleware/upload.js'

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
const LOGO_BG = '#0B1F3A'
const TITLE_BG = '#F8FAFC'
const FOOTER_BG = '#F1F5F9'
const LOGO_CID = 'brand-logo'

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

function resolveLogoFilePath(logoPath) {
  if (!logoPath) return null
  if (/^https?:\/\//i.test(logoPath)) return null

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

function loadInlineLogo(logoPath) {
  const filePath = resolveLogoFilePath(logoPath)
  if (!filePath || !fs.existsSync(filePath)) return null

  const content = fs.readFileSync(filePath).toString('base64')
  const type = mimeFromPath(filePath)
  const filename = path.basename(filePath)

  return {
    content,
    type,
    filename,
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
  const inlineLogo = loadInlineLogo(brand.logoPath)
  // Prefer CID (works even when API URL is localhost). Fall back to absolute URL if needed.
  const logoSrc = inlineLogo ? `cid:${LOGO_CID}` : brand.logoUrl
  const resolvedEyebrow = eyebrow || appName
  const resolvedFooter =
    footerNote || `This message was sent because of activity on your ${appName} account.`

  const logoBlock = logoSrc
    ? `
      <img
        src="${escapeHtml(logoSrc)}"
        alt="${escapeHtml(appName)}"
        width="180"
        style="display:block;width:180px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;"
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

                  <!-- Logo on dark blue -->
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${LOGO_BG}" style="background:${LOGO_BG};border-collapse:collapse;">
                    <tr>
                      <td align="left" style="padding:22px 28px 18px 28px;">
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
        filename: inlineLogo.filename,
        type: inlineLogo.type,
        disposition: 'inline',
        content_id: inlineLogo.contentId,
      },
    ]
  }

  await sgMail.send(message)
}

async function sendViaResend({ to, subject, html, inlineLogo }) {
  if (!env.RESEND_API_KEY) {
    console.log(`[Email - Dev Mode] To: ${to} | Subject: ${subject}`)
    return
  }

  const body = {
    from: env.SENDGRID_FROM_EMAIL,
    to,
    subject,
    html,
  }

  if (inlineLogo) {
    body.attachments = [
      {
        content: inlineLogo.content,
        filename: inlineLogo.filename,
        contentId: inlineLogo.contentId,
        content_type: inlineLogo.type,
      },
    ]
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`Resend API error: ${response.statusText}`)
  }
}

async function sendEmail(payload) {
  try {
    if (env.EMAIL_PROVIDER === 'resend') {
      return await sendViaResend(payload)
    }
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

  async sendPasswordResetEmail(to, token) {
    const APP_NAME = await appName()
    const resetUrl = `${env.PUBLIC_SITE_URL}/reset-password?token=${token}`
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
        body: 'Log in to your business dashboard to read the review and respond when appropriate.',
        primaryCta: { label: 'Open business dashboard', href: `${env.BUSINESS_PORTAL_URL}/reviews` },
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
    await sendTemplatedEmail({
      to,
      subject: `${businessName} invites you to leave a review`,
      template: {
        eyebrow: 'Review invitation',
        title: `Share your experience with ${escapeHtml(businessName)}`,
        intro: `${escapeHtml(businessName)} invited you to leave a review on ${APP_NAME}.`,
        body: 'If you already have an account, you can log in and write your review right away. If not, you can sign up first and then continue.',
        primaryCta: { label: 'Write a review', href: inviteUrl },
        footerNote: 'You are receiving this because a business invited you to leave a review on Check A Review.',
      },
    })
  },

  async sendSubscriptionConfirmation(to, plan) {
    await sendTemplatedEmail({
      to,
      subject: `Subscription confirmed - ${plan} plan`,
      template: {
        eyebrow: 'Subscription active',
        title: `${escapeHtml(plan)} plan confirmed`,
        intro: `Your <strong>${escapeHtml(plan)}</strong> subscription is now active.`,
        body: 'Thank you for choosing Check A Review. Your account is ready to use with the features included in your plan.',
        primaryCta: { label: 'Open business dashboard', href: `${env.BUSINESS_PORTAL_URL}/dashboard` },
      },
    })
  },

  async sendPaymentReceipt(to, amount, plan) {
    await sendTemplatedEmail({
      to,
      subject: 'Payment receipt',
      template: {
        eyebrow: 'Payment successful',
        title: 'Your payment was received',
        intro: `We successfully processed your payment for the <strong>${escapeHtml(plan)}</strong> plan.`,
        body: `Amount paid: <strong>$${(amount / 100).toFixed(2)}</strong>.`,
        stats: [{ value: `$${(amount / 100).toFixed(2)}`, label: 'Paid' }],
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
