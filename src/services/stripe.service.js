import Stripe from 'stripe'
import { env } from '../config/env.js'
import { AppError } from '../utils/helpers.js'

const stripe = env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null

const PLAN_PRICES = {
  starter: env.STRIPE_STARTER_PRICE_ID,
  premium: env.STRIPE_PREMIUM_PRICE_ID,
}

export const stripeService = {
  isConfigured() {
    return !!stripe
  },

  async createCustomer(email, name) {
    if (!stripe) throw new AppError('Stripe is not configured', 503)
    return stripe.customers.create({ email, name })
  },

  async createCheckoutSession({ customerId, plan, businessId, successUrl, cancelUrl }) {
    if (!stripe) throw new AppError('Stripe is not configured', 503)

    const priceId = PLAN_PRICES[plan]
    if (!priceId) throw new AppError(`Invalid plan: ${plan}`, 400)

    return stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { businessId, plan },
    })
  },

  async createPortalSession(customerId, returnUrl) {
    if (!stripe) throw new AppError('Stripe is not configured', 503)
    return stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })
  },

  constructWebhookEvent(payload, signature) {
    if (!stripe) throw new AppError('Stripe is not configured', 503)
    return stripe.webhooks.constructEvent(payload, signature, env.STRIPE_WEBHOOK_SECRET)
  },
}
