import { randomUUID } from 'crypto'
import { SquareClient, SquareEnvironment, WebhooksHelper } from 'square'
import { env } from '../config/env.js'
import { AppError } from '../utils/helpers.js'

const environment =
  String(env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase() === 'production'
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox

const client =
  env.SQUARE_ACCESS_TOKEN
    ? new SquareClient({
        token: env.SQUARE_ACCESS_TOKEN,
        environment,
      })
    : null

function assertCredentials() {
  if (!client) throw new AppError('Square is not configured', 503)
  if (!env.SQUARE_LOCATION_ID || /your_square/i.test(env.SQUARE_LOCATION_ID)) {
    throw new AppError('SQUARE_LOCATION_ID is not configured', 503)
  }
}

function moneyAmount(cents) {
  return BigInt(Math.round(Number(cents) || 0))
}

export const squareService = {
  hasCredentials() {
    const token = String(env.SQUARE_ACCESS_TOKEN || '')
    const location = String(env.SQUARE_LOCATION_ID || '')
    const placeholder = /your_square|change-me|^$/i
    return Boolean(client && token && location && !placeholder.test(token) && !placeholder.test(location))
  },

  isConfigured() {
    // credentials only — plan IDs can come from CRM/DB after sync
    return this.hasCredentials()
  },

  async createCustomer(email, name) {
    assertCredentials()
    const response = await client.customers.create({
      idempotencyKey: randomUUID(),
      emailAddress: email,
      givenName: name || undefined,
      referenceId: email,
    })
    if (!response.customer?.id) {
      throw new AppError('Failed to create Square customer', 502)
    }
    return response.customer
  },

  /**
   * Create or update a Square Catalog subscription plan + monthly variation.
   * Price changes create a new variation (Square locks some phase fields after create).
   */
  async upsertSubscriptionPlan({
    key,
    name,
    amountCents,
    currency = 'USD',
    cadence = 'MONTHLY',
    existingPlanId = null,
    existingVariationId = null,
  }) {
    assertCredentials()

    let planId = existingPlanId || null
    let planVersion = null

    if (planId) {
      try {
        const existing = await client.catalog.object.get({ objectId: planId })
        planVersion = existing.object?.version ?? null
      } catch {
        planId = null
        planVersion = null
      }
    }

    if (!planId) {
      const createdPlan = await client.catalog.object.upsert({
        idempotencyKey: randomUUID(),
        object: {
          type: 'SUBSCRIPTION_PLAN',
          id: `#car-${key}-plan`,
          subscriptionPlanData: {
            name: name || `${key} plan`,
            allItems: true,
          },
        },
      })
      planId = createdPlan.catalogObject?.id
      planVersion = createdPlan.catalogObject?.version
      if (!planId) throw new AppError('Failed to create Square subscription plan', 502)
    } else {
      await client.catalog.object.upsert({
        idempotencyKey: randomUUID(),
        object: {
          type: 'SUBSCRIPTION_PLAN',
          id: planId,
          version: planVersion ?? undefined,
          subscriptionPlanData: {
            name: name || `${key} plan`,
            allItems: true,
          },
        },
      })
    }

    // Always create a fresh variation when syncing so amount/cadence updates take effect.
    const variationTempId = `#car-${key}-variation-${Date.now()}`
    const createdVariation = await client.catalog.object.upsert({
      idempotencyKey: randomUUID(),
      object: {
        type: 'SUBSCRIPTION_PLAN_VARIATION',
        id: variationTempId,
        subscriptionPlanVariationData: {
          name: `${name || key} ${cadence.toLowerCase()}`,
          subscriptionPlanId: planId,
          phases: [
            {
              cadence,
              ordinal: BigInt(0),
              pricing: {
                type: 'STATIC',
                priceMoney: {
                  amount: moneyAmount(amountCents),
                  currency: currency || 'USD',
                },
              },
            },
          ],
        },
      },
    })

    const variationId = createdVariation.catalogObject?.id
    if (!variationId) throw new AppError('Failed to create Square plan variation', 502)

    // Optionally present superseded note on old variation (best-effort).
    if (existingVariationId && existingVariationId !== variationId) {
      try {
        const old = await client.catalog.object.get({ objectId: existingVariationId })
        if (old.object) {
          await client.catalog.object.upsert({
            idempotencyKey: randomUUID(),
            object: {
              ...old.object,
              subscriptionPlanVariationData: {
                ...old.object.subscriptionPlanVariationData,
                successorPlanVariationId: variationId,
              },
            },
          })
        }
      } catch {
        // ignore — old variation can remain unused
      }
    }

    return { planId, variationId }
  },

  async createCheckoutLink({
    customerId,
    plan,
    planConfig,
    businessId,
    email,
    successUrl,
  }) {
    assertCredentials()

    const config = planConfig
    if (!config?.planId) {
      throw new AppError(
        `Square plan "${plan}" is not synced yet. Open CRM → Billing plans and click Sync to Square.`,
        400,
      )
    }

    const response = await client.checkout.paymentLinks.create({
      idempotencyKey: randomUUID(),
      description: `Check A Review ${config.name}`,
      quickPay: {
        name: config.name,
        priceMoney: {
          amount: moneyAmount(config.amountCents),
          currency: config.currency || env.SQUARE_CURRENCY || 'USD',
        },
        locationId: env.SQUARE_LOCATION_ID,
      },
      checkoutOptions: {
        subscriptionPlanId: config.planId,
        redirectUrl: successUrl,
      },
      prePopulatedData: {
        buyerEmail: email || undefined,
      },
      paymentNote: JSON.stringify({ businessId, plan, customerId }),
    })

    const paymentLink = response.paymentLink
    if (!paymentLink?.url) {
      throw new AppError('Failed to create Square checkout link', 502)
    }

    return {
      id: paymentLink.id,
      url: paymentLink.url,
    }
  },

  async cancelSubscription(subscriptionId) {
    assertCredentials()
    if (!subscriptionId) throw new AppError('No active Square subscription', 400)
    const response = await client.subscriptions.cancel({
      subscriptionId,
    })
    return response.subscription
  },

  async verifyWebhook(rawBody, signatureHeader) {
    if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
      throw new AppError('SQUARE_WEBHOOK_SIGNATURE_KEY is not configured', 503)
    }
    if (!env.SQUARE_WEBHOOK_NOTIFICATION_URL) {
      throw new AppError('SQUARE_WEBHOOK_NOTIFICATION_URL is not configured', 503)
    }

    const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '')
    const valid = await WebhooksHelper.verifySignature({
      requestBody: body,
      signatureHeader: signatureHeader || '',
      signatureKey: env.SQUARE_WEBHOOK_SIGNATURE_KEY,
      notificationUrl: env.SQUARE_WEBHOOK_NOTIFICATION_URL,
    })

    if (!valid) {
      throw new AppError('Invalid Square webhook signature', 400)
    }

    return JSON.parse(body)
  },
}
