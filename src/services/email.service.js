import sgMail from '@sendgrid/mail'
import { env } from '../config/env.js'

const hasValidSendGridKey = Boolean(env.SENDGRID_API_KEY && env.SENDGRID_API_KEY.startsWith('SG.'))
const APP_NAME = 'Check A Review'
const BRAND = '#FF4081'
const BRAND_DARK = '#BE185D'
const SLATE = '#0F172A'
const MUTED = '#64748B'
const BORDER = '#E2E8F0'

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

function sectionCard({ title, body, accent = '#FFF1F6' }) {
  return `
    <div style="margin-top:16px;border:1px solid ${BORDER};border-radius:18px;padding:18px;background:${accent};">
      <div style="font-size:15px;font-weight:700;color:${SLATE};margin-bottom:6px;">${title}</div>
      <div style="font-size:14px;line-height:1.7;color:${MUTED};">${body}</div>
    </div>
  `
}

function statCard({ value, label }) {
  return `
    <td style="width:33.33%;padding:0 6px 0 0;">
      <div style="border:1px solid ${BORDER};border-radius:16px;padding:16px 10px;text-align:center;background:#ffffff;">
        <div style="font-size:24px;font-weight:800;color:${SLATE};">${value}</div>
        <div style="margin-top:6px;font-size:12px;color:${MUTED};">${label}</div>
      </div>
    </td>
  `
}

function renderEmailTemplate({
  eyebrow = APP_NAME,
  title,
  intro,
  body,
  primaryCta,
  secondaryCta,
  sections = [],
  stats = [],
  footerNote = 'This message was sent because of activity on your Check A Review account.',
}) {
  const primaryButton = primaryCta
    ? `
      <a href="${primaryCta.href}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px;margin-right:10px;">
        ${primaryCta.label}
      </a>
    `
    : ''

  const secondaryButton = secondaryCta
    ? `
      <a href="${secondaryCta.href}" style="display:inline-block;background:#ffffff;color:${SLATE};text-decoration:none;font-weight:700;padding:14px 22px;border-radius:999px;border:1px solid ${BORDER};">
        ${secondaryCta.label}
      </a>
    `
    : ''

  const statsTable =
    stats.length > 0
      ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:18px;">
          <tr>
            ${stats.map(statCard).join('')}
          </tr>
        </table>
      `
      : ''

  return `
    <div style="margin:0;padding:24px;background:#F8FAFC;font-family:Arial,sans-serif;color:${SLATE};">
      <div style="max-width:640px;margin:0 auto;">
        <div style="background:linear-gradient(135deg, ${SLATE} 0%, ${BRAND_DARK} 100%);padding:18px 24px;border-radius:24px 24px 0 0;color:#ffffff;">
          <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.86;font-weight:700;">${eyebrow}</div>
          <div style="margin-top:14px;font-size:32px;line-height:1.2;font-weight:800;">${title}</div>
        </div>
        <div style="background:#ffffff;border:1px solid ${BORDER};border-top:none;border-radius:0 0 24px 24px;padding:28px 24px;">
          <div style="font-size:15px;line-height:1.8;color:${MUTED};">${intro}</div>
          <div style="margin-top:14px;font-size:15px;line-height:1.8;color:${SLATE};">${body}</div>
          ${(primaryButton || secondaryButton) ? `<div style="margin-top:24px;">${primaryButton}${secondaryButton}</div>` : ''}
          ${statsTable}
          ${sections.join('')}
          <div style="margin-top:24px;padding-top:18px;border-top:1px solid ${BORDER};font-size:12px;line-height:1.7;color:${MUTED};">
            ${footerNote}<br />
            If you did not expect this message, you can safely ignore it.
          </div>
        </div>
      </div>
    </div>
  `
}

async function sendViaSendGrid({ to, subject, html }) {
  if (!hasValidSendGridKey) {
    console.log(`[Email - Dev Mode] To: ${to} | Subject: ${subject}`)
    return
  }
  await sgMail.send({
    to,
    from: env.SENDGRID_FROM_EMAIL,
    subject,
    html,
  })
}

async function sendViaResend({ to, subject, html }) {
  if (!env.RESEND_API_KEY) {
    console.log(`[Email - Dev Mode] To: ${to} | Subject: ${subject}`)
    return
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.SENDGRID_FROM_EMAIL,
      to,
      subject,
      html,
    }),
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
    // Email should never break core flows like review submission.
    console.warn(`[Email] Failed to send "${payload.subject}" to ${payload.to}:`, err.message || err)
  }
}

export const emailService = {
  async sendVerificationEmail(to, name, token) {
    const verifyUrl = `${env.PUBLIC_SITE_URL}/verify-email?token=${token}`
    await sendEmail({
      to,
      subject: `Welcome to ${APP_NAME} - confirm your email`,
      html: renderEmailTemplate({
        eyebrow: `Welcome to ${APP_NAME}`,
        title: 'Your account is almost ready',
        intro: `Hi ${escapeHtml(name)}, thanks for joining ${APP_NAME}.`,
        body: `Please confirm your email address to activate your account and start collecting, reading, and managing trusted reviews.`,
        primaryCta: { label: 'Confirm email', href: verifyUrl },
        sections: [
          sectionCard({
            title: 'What happens next',
            body: 'After verification, you can complete your profile, explore businesses, and manage your reviews in one place.',
          }),
        ],
        footerNote: 'This verification link expires in 24 hours.',
      }),
    })
  },

  async sendPasswordResetEmail(to, token) {
    const resetUrl = `${env.PUBLIC_SITE_URL}/reset-password?token=${token}`
    await sendEmail({
      to,
      subject: 'Reset your password',
      html: renderEmailTemplate({
        eyebrow: APP_NAME,
        title: 'Reset your password',
        intro: 'We received a request to reset your password.',
        body: 'Use the button below to choose a new password and get back into your account.',
        primaryCta: { label: 'Create a new password', href: resetUrl },
        footerNote: 'This password reset link expires in 1 hour.',
      }),
    })
  },

  async sendReviewConfirmation(to, businessName) {
    await sendEmail({
      to,
      subject: 'Review submitted — processing',
      html: renderEmailTemplate({
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
      }),
    })
  },

  async sendReviewPublishedEmail(to, businessName) {
    await sendEmail({
      to,
      subject: 'Your review has been published',
      html: renderEmailTemplate({
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
      }),
    })
  },

  async sendBusinessReplyNotification(to, businessName) {
    await sendEmail({
      to,
      subject: `${businessName} replied to your review`,
      html: renderEmailTemplate({
        eyebrow: 'New business reply',
        title: 'A business responded to your review',
        intro: `<strong>${escapeHtml(businessName)}</strong> has posted a reply to your review.`,
        body: 'Open your account to read the response and decide whether you want to update your review.',
        primaryCta: { label: 'Open my reviews', href: `${env.PUBLIC_SITE_URL}/users/reviews` },
        footerNote: 'You are receiving this because a business replied to one of your reviews.',
      }),
    })
  },

  async sendNewReviewNotification(to, businessName, rating) {
    await sendEmail({
      to,
      subject: `New ${rating}-star review for ${businessName}`,
      html: renderEmailTemplate({
        eyebrow: 'New customer review',
        title: 'You received a new review',
        intro: `A customer just left a <strong>${escapeHtml(rating)}-star</strong> review for <strong>${escapeHtml(businessName)}</strong>.`,
        body: 'Log in to your business dashboard to read the review and respond when appropriate.',
        primaryCta: { label: 'Open business dashboard', href: `${env.BUSINESS_PORTAL_URL}/reviews` },
        footerNote: 'You are receiving this because your business received a new review.',
      }),
    })
  },

  async sendReviewUpdatedNotification(to, businessName, rating) {
    await sendEmail({
      to,
      subject: `A review was updated for ${businessName}`,
      html: renderEmailTemplate({
        eyebrow: 'Review updated',
        title: 'A customer updated their review',
        intro: `A customer updated a <strong>${escapeHtml(rating)}-star</strong> review for <strong>${escapeHtml(businessName)}</strong>.`,
        body: 'You can open your dashboard to view the latest version and decide whether you want to update your reply.',
        primaryCta: { label: 'View updated review', href: `${env.BUSINESS_PORTAL_URL}/reviews` },
        footerNote: 'You are receiving this because a review for your business was edited.',
      }),
    })
  },

  async sendReviewInvitation(to, businessName, inviteUrl) {
    await sendEmail({
      to,
      subject: `${businessName} invites you to leave a review`,
      html: renderEmailTemplate({
        eyebrow: 'Review invitation',
        title: `Share your experience with ${escapeHtml(businessName)}`,
        intro: `${escapeHtml(businessName)} invited you to leave a review on ${APP_NAME}.`,
        body: 'If you already have an account, you can log in and write your review right away. If not, you can sign up first and then continue.',
        primaryCta: { label: 'Write a review', href: inviteUrl },
        sections: [
          sectionCard({
            title: 'Direct link',
            body: `<a href="${inviteUrl}" style="color:${BRAND_DARK};word-break:break-all;">${inviteUrl}</a>`,
            accent: '#ffffff',
          }),
        ],
        footerNote: 'You are receiving this because a business invited you to leave a review on Check A Review.',
      }),
    })
  },

  async sendSubscriptionConfirmation(to, plan) {
    await sendEmail({
      to,
      subject: `Subscription confirmed - ${plan} plan`,
      html: renderEmailTemplate({
        eyebrow: 'Subscription active',
        title: `${escapeHtml(plan)} plan confirmed`,
        intro: `Your <strong>${escapeHtml(plan)}</strong> subscription is now active.`,
        body: 'Thank you for choosing Check A Review. Your account is ready to use with the features included in your plan.',
        primaryCta: { label: 'Open business dashboard', href: `${env.BUSINESS_PORTAL_URL}/dashboard` },
      }),
    })
  },

  async sendPaymentReceipt(to, amount, plan) {
    await sendEmail({
      to,
      subject: 'Payment receipt',
      html: renderEmailTemplate({
        eyebrow: 'Payment successful',
        title: 'Your payment was received',
        intro: `We successfully processed your payment for the <strong>${escapeHtml(plan)}</strong> plan.`,
        body: `Amount paid: <strong>$${(amount / 100).toFixed(2)}</strong>.`,
        stats: [{ value: `$${(amount / 100).toFixed(2)}`, label: 'Paid' }],
        primaryCta: { label: 'View subscription', href: `${env.BUSINESS_PORTAL_URL}/subscription` },
      }),
    })
  },
}
