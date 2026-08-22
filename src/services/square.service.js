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

function squareErrorMessage(err, fallback = 'Square request failed') {
  const detail = err?.errors?.[0]?.detail || err?.body?.errors?.[0]?.detail
  return detail || err?.message || fallback
}

function wrapSquareError(err, fallback) {
  if (err instanceof AppError) throw err
  const status = Number(err?.statusCode) || 502
  throw new AppError(squareErrorMessage(err, fallback), status >= 400 && status < 600 ? status : 502)
}

/** Square checkout rejects reserved domains like example.com for pre-filled buyer email. */
function squareCheckoutEmail(email) {
  const value = String(email || '').trim().toLowerCase()
  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return undefined

  const domain = value.split('@')[1]
  const blocked = ['example.com', 'example.org', 'example.net', 'example', 'invalid', 'localhost', 'test']
  if (blocked.some((part) => domain === part || domain.endsWith(`.${part}`))) {
    return undefined
  }

  return value
}

function squareCadence(cadence) {
  const value = String(cadence || 'YEARLY').toUpperCase()
  if (value === 'YEARLY') return 'ANNUAL'
  return value
}

function buildPhases({ cadence, amountCents, trialDays = 0, currency = 'GBP' }) {
  const paid = {
    cadence: squareCadence(cadence),
    pricing: {
      type: 'STATIC',
      priceMoney: {
        amount: moneyAmount(amountCents),
        currency,
      },
    },
  }
  const days = Number(trialDays || 0)
  if (days >= 1) {
    return [
      {
        cadence: 'DAILY',
        ordinal: BigInt(0),
        periods: days,
        pricing: {
          type: 'STATIC',
          priceMoney: { amount: moneyAmount(0), currency },
        },
      },
      { ...paid, ordinal: BigInt(1) },
    ]
  }
  return [{ ...paid, ordinal: BigInt(0) }]
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
      currency = 'GBP',
    cadence = 'YEARLY',
    trialDays = 0,
    existingPlanId = null,
    existingVariationId = null,
  }) {
    assertCredentials()

    let planId = existingPlanId || null

    if (planId) {
      try {
        await client.catalog.object.get({ objectId: planId })
      } catch {
        planId = null
      }
    }

    if (!planId) {
      try {
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
        if (!planId) throw new AppError('Failed to create Square subscription plan', 502)
      } catch (err) {
        wrapSquareError(err, `Failed to create Square subscription plan "${key}"`)
      }
    }
    // Square rejects plan updates that omit existing variations — skip plan upsert on re-sync.

    // Always create a fresh variation when syncing so amount/cadence updates take effect.
    const variationTempId = `#car-${key}-variation-${Date.now()}`
    let createdVariation
    try {
      createdVariation = await client.catalog.object.upsert({
        idempotencyKey: randomUUID(),
        object: {
          type: 'SUBSCRIPTION_PLAN_VARIATION',
          id: variationTempId,
          subscriptionPlanVariationData: {
            name: `${name || key} ${String(cadence || 'yearly').toLowerCase()}`,
            subscriptionPlanId: planId,
            phases: buildPhases({ cadence, amountCents, trialDays, currency }),
          },
        },
      })
    } catch (err) {
      wrapSquareError(err, `Failed to sync Square plan variation for "${key}"`)
    }

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

    const buyerEmail = squareCheckoutEmail(email)
    const payload = {
      idempotencyKey: randomUUID(),
      description: `Check A Review ${config.name}`,
      quickPay: {
        name: config.name,
        priceMoney: {
          amount: moneyAmount(config.amountCents),
          currency: config.currency || 'GBP',
        },
        locationId: env.SQUARE_LOCATION_ID,
      },
      checkoutOptions: {
        subscriptionPlanId: config.variationId || config.planId,
        redirectUrl: successUrl,
      },
      paymentNote: JSON.stringify({ businessId, plan, customerId }),
    }

    if (buyerEmail) {
      payload.prePopulatedData = { buyerEmail }
    }

    let response
    try {
      response = await client.checkout.paymentLinks.create(payload)
    } catch (err) {
      wrapSquareError(err, 'Failed to create Square checkout link')
    }

    const paymentLink = response.paymentLink
    const checkoutUrl = paymentLink?.url
    const testingPanelUrl = paymentLink?.longUrl
    const isSandbox = String(env.SQUARE_ENVIRONMENT || 'sandbox').toLowerCase() !== 'production'
    const url = (isSandbox && testingPanelUrl) ? testingPanelUrl : checkoutUrl

    if (!url) {
      throw new AppError('Failed to create Square checkout link', 502)
    }

    return {
      id: paymentLink.id,
      url,
      previewUrl: isSandbox ? checkoutUrl : undefined,
      sandboxMode: isSandbox,
    }
  },

  async getSubscription(subscriptionId) {
    assertCredentials()
    if (!subscriptionId) return null
    try {
      const response = await client.subscriptions.get({ subscriptionId })
      return response.subscription || null
    } catch {
      return null
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
