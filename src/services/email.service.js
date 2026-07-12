import sgMail from '@sendgrid/mail'
import { env } from '../config/env.js'

if (env.SENDGRID_API_KEY) {
  sgMail.setApiKey(env.SENDGRID_API_KEY)
}

async function sendViaSendGrid({ to, subject, html }) {
  if (!env.SENDGRID_API_KEY) {
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
  if (env.EMAIL_PROVIDER === 'resend') {
    return sendViaResend(payload)
  }
  return sendViaSendGrid(payload)
}

export const emailService = {
  async sendVerificationEmail(to, name, token) {
    const verifyUrl = `${env.CLIENT_URL}/verify-email?token=${token}`
    await sendEmail({
      to,
      subject: 'Verify your Check A Review account',
      html: `
        <h2>Welcome, ${name}!</h2>
        <p>Please verify your email address by clicking the link below:</p>
        <a href="${verifyUrl}">Verify Email</a>
        <p>This link expires in 24 hours.</p>
      `,
    })
  },

  async sendPasswordResetEmail(to, token) {
    const resetUrl = `${env.CLIENT_URL}/reset-password?token=${token}`
    await sendEmail({
      to,
      subject: 'Reset your password',
      html: `
        <h2>Password Reset</h2>
        <p>Click the link below to reset your password:</p>
        <a href="${resetUrl}">Reset Password</a>
        <p>This link expires in 1 hour.</p>
      `,
    })
  },

  async sendReviewConfirmation(to, businessName) {
    await sendEmail({
      to,
      subject: 'Review submitted successfully',
      html: `<p>Your review for <strong>${businessName}</strong> has been submitted and is being analyzed.</p>`,
    })
  },

  async sendReviewPublishedEmail(to, businessName) {
    await sendEmail({
      to,
      subject: 'Your review has been published',
      html: `<p>Your review for <strong>${businessName}</strong> is now live on Check A Review.</p>`,
    })
  },

  async sendBusinessReplyNotification(to, businessName) {
    await sendEmail({
      to,
      subject: `${businessName} replied to your review`,
      html: `<p><strong>${businessName}</strong> has replied to your review. Log in to read the response.</p>`,
    })
  },

  async sendNewReviewNotification(to, businessName, rating) {
    await sendEmail({
      to,
      subject: `New ${rating}-star review for ${businessName}`,
      html: `<p>You received a new <strong>${rating}-star</strong> review. Log in to your dashboard to view and reply.</p>`,
    })
  },

  async sendReviewInvitation(to, businessName, inviteUrl) {
    await sendEmail({
      to,
      subject: `${businessName} invites you to leave a review`,
      html: `
        <h2>Share your experience with ${businessName}</h2>
        <p>We'd love to hear about your experience. Click below to leave a review:</p>
        <a href="${inviteUrl}">Write a Review</a>
      `,
    })
  },

  async sendSubscriptionConfirmation(to, plan) {
    await sendEmail({
      to,
      subject: `Subscription confirmed - ${plan} plan`,
      html: `<p>Your <strong>${plan}</strong> subscription is now active. Thank you for choosing Check A Review!</p>`,
    })
  },

  async sendPaymentReceipt(to, amount, plan) {
    await sendEmail({
      to,
      subject: 'Payment receipt',
      html: `<p>Payment of <strong>$${(amount / 100).toFixed(2)}</strong> for the <strong>${plan}</strong> plan was successful.</p>`,
    })
  },
}
