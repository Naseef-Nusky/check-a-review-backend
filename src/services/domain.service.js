import { lookup, Resolver } from 'node:dns/promises'
import { query } from '../db/pool.js'
import { AppError } from '../utils/helpers.js'
import { getPlan } from '../config/planCatalog.js'
import { billingPlansService } from './billingPlans.service.js'
import { getBusinessPlanKey } from './planEntitlements.service.js'
import {
  assertBusinessAccess,
  assertBusinessOwner,
} from './businessAccess.service.js'

const DNS_TIMEOUT_MS = 5000

function dnsTimeoutError() {
  const err = new Error('DNS lookup timed out')
  err.code = 'ETIMEOUT'
  return err
}

async function withTimeout(promise, ms) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(dnsTimeoutError()), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function lookupKind(resolveFn) {
  try {
    const answers = await withTimeout(resolveFn(), DNS_TIMEOUT_MS)
    return Array.isArray(answers) && answers.length > 0 ? 'yes' : 'empty'
  } catch (err) {
    if (err?.code === 'ENOTFOUND') return 'nx'
    if (err?.code === 'ENODATA') return 'empty'
    throw err
  }
}

async function resolveOnPublicDns(hostname) {
  const resolver = new Resolver()
  resolver.setServers(['8.8.8.8', '1.1.1.1'])
  const ipv4 = await lookupKind(() => resolver.resolve4(hostname))
  if (ipv4 === 'yes') return true
  if (ipv4 === 'nx') return false

  const extra = await Promise.allSettled([
    lookupKind(() => resolver.resolve6(hostname)),
    lookupKind(() => resolver.resolveCname(hostname)),
  ])
  if (extra.some((result) => result.status === 'fulfilled' && result.value === 'yes')) {
    return true
  }
  const networkError = extra.find((result) => result.status === 'rejected')
  if (networkError && extra.every((result) => result.status === 'rejected' || result.value !== 'yes')) {
    const anyNxOrEmpty = extra.some((result) => result.status === 'fulfilled')
    if (!anyNxOrEmpty) throw networkError.reason
  }
  return false
}

async function resolveOnSystemDns(hostname) {
  const answers = await withTimeout(lookup(hostname, { all: true }), DNS_TIMEOUT_MS)
  return Array.isArray(answers) ? answers.length > 0 : Boolean(answers)
}

export async function assertDomainResolves(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '')
  if (!host) {
    throw new AppError('Enter a valid domain, e.g. mybusiness.com', 400)
  }

  const candidates = [host, `www.${host}`]
  let lastError = null

  for (const candidate of candidates) {
    try {
      if (await resolveOnPublicDns(candidate)) return
    } catch (err) {
      lastError = err
      try {
        if (await resolveOnSystemDns(candidate)) return
        lastError = null
      } catch (fallbackErr) {
        lastError = fallbackErr
      }
    }
  }

  const code = lastError?.code
  if (code === 'ETIMEOUT' || code === 'EAI_AGAIN' || code === 'ECONNREFUSED') {
    throw new AppError(
      `We could not verify ${host} right now. Check your connection and try again.`,
      503,
      'DOMAIN_DNS',
    )
  }

  throw new AppError(
    `${host} does not appear to be a live domain. Check the spelling, or wait until the domain is registered and DNS is active.`,
    400,
    'DOMAIN_DNS',
  )
}

export async function assertWebsiteResolves(input) {
  const hostname = normalizeDomainInput(input)
  try {
    const { settingsService } = await import('./settings.service.js')
    const enabled = await settingsService.isDomainDnsCheckEnabled()
    if (!enabled) return hostname
  } catch {
    // If settings cannot be read, keep the safety check on
  }
  await assertDomainResolves(hostname)
  return hostname
}

let domainsTableReady = false

export async function ensureBusinessDomainsTable() {
  if (domainsTableReady) return

  await query(`
    CREATE TABLE IF NOT EXISTS business_domains (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      domain VARCHAR(255) NOT NULL,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'disabled')),
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (business_id, domain)
    )
  `)

  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS business_domains_one_primary
    ON business_domains (business_id)
    WHERE is_primary = TRUE AND status = 'active'
  `)

  domainsTableReady = true
}

function parseLimit(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!text) return 1
  if (['unlimited', '∞', 'inf', 'infinite'].includes(text)) return Number.POSITIVE_INFINITY
  const match = text.match(/\d+/)
  if (!match) return 1
  const n = parseInt(match[0], 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function formatLimit(limit) {
  return Number.isFinite(limit) ? String(limit) : 'Unlimited'
}

export function normalizeDomainInput(input) {
  let raw = String(input || '').trim().toLowerCase()
  if (!raw) throw new AppError('Enter a website domain', 400)

  raw = raw.replace(/\s+/g, '')
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`

  let hostname
  try {
    hostname = new URL(raw).hostname
  } catch {
    throw new AppError('Enter a valid domain, e.g. mybusiness.com', 400)
  }

  hostname = hostname.replace(/^www\./, '').replace(/\.$/, '')
  if (!hostname || !hostname.includes('.') || hostname.length > 253) {
    throw new AppError('Enter a valid domain, e.g. mybusiness.com', 400)
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(hostname)) {
    throw new AppError('Enter a valid domain, e.g. mybusiness.com', 400)
  }

  return hostname
}

function websiteFromDomain(domain) {
  return `https://${domain}`
}

async function getDomainsLimitForPlan(planKey) {
  const key = String(planKey || 'free').toLowerCase()
  if (key === 'free') return getPlan('free').domains
  try {
    const row = await billingPlansService.getByKey(key)
    return row.domains
  } catch {
    return getPlan(key).domains
  }
}

async function syncPrimaryWebsite(businessId) {
  const primary = await query(
    `SELECT domain FROM business_domains
     WHERE business_id = $1 AND status = 'active' AND is_primary = TRUE
     LIMIT 1`,
    [businessId],
  )
  const website = primary.rows[0]?.domain ? websiteFromDomain(primary.rows[0].domain) : null
  await query(`UPDATE businesses SET website = $1, updated_at = NOW() WHERE id = $2`, [
    website,
    businessId,
  ])
  return website
}

async function migrateWebsiteIfNeeded(businessId) {
  await ensureBusinessDomainsTable()
  const existing = await query(
    `SELECT COUNT(*)::int AS count FROM business_domains WHERE business_id = $1 AND status = 'active'`,
    [businessId],
  )
  if ((existing.rows[0]?.count || 0) > 0) return

  const business = await query(`SELECT website FROM businesses WHERE id = $1`, [businessId])
  const website = business.rows[0]?.website
  if (!website) return

  try {
    const domain = normalizeDomainInput(website)
    await query(
      `INSERT INTO business_domains (business_id, domain, is_primary, status)
       VALUES ($1, $2, TRUE, 'active')
       ON CONFLICT (business_id, domain) DO UPDATE
         SET is_primary = TRUE, status = 'active', updated_at = NOW()`,
      [businessId, domain],
    )
  } catch {
    // Ignore invalid legacy website strings
  }
}

export const domainService = {
  async listActiveDomainHosts(businessId) {
    await ensureBusinessDomainsTable()
    await migrateWebsiteIfNeeded(businessId)
    const result = await query(
      `SELECT domain FROM business_domains WHERE business_id = $1 AND status = 'active' ORDER BY is_primary DESC, created_at ASC`,
      [businessId],
    )
    return result.rows.map((row) => String(row.domain).toLowerCase())
  },

  hostMatchesDomain(host, domain) {
    const h = String(host || '')
      .toLowerCase()
      .replace(/^www\./, '')
    const d = String(domain || '')
      .toLowerCase()
      .replace(/^www\./, '')
    if (!h || !d) return false
    return h === d || h.endsWith(`.${d}`)
  },

  async getWidgetAccess(businessId, { host = null, preview = false, appHosts = [] } = {}) {
    const domains = await this.listActiveDomainHosts(businessId)
    if (domains.length === 0) {
      return {
        allowed: false,
        code: 'DOMAIN_REQUIRED',
        message: 'Add at least one domain before using the review widget.',
        domains,
      }
    }

    if (preview) {
      return { allowed: true, preview: true, domains }
    }

    const normalizedHost = String(host || '')
      .toLowerCase()
      .replace(/^www\./, '')

    if (normalizedHost && appHosts.some((appHost) => this.hostMatchesDomain(normalizedHost, appHost))) {
      return { allowed: true, preview: true, domains }
    }

    if (!normalizedHost) {
      return {
        allowed: false,
        code: 'DOMAIN_NOT_ALLOWED',
        message: 'This widget can only be embedded on your registered domains.',
        domains,
      }
    }

    const matched = domains.some((domain) => this.hostMatchesDomain(normalizedHost, domain))
    if (!matched) {
      return {
        allowed: false,
        code: 'DOMAIN_NOT_ALLOWED',
        message: `Widget is not allowed on ${normalizedHost}. Add this domain in Domains, then try again.`,
        domains,
      }
    }

    return { allowed: true, preview: false, domains, host: normalizedHost }
  },

  async getLimitInfo(businessId) {
    await ensureBusinessDomainsTable()
    await migrateWebsiteIfNeeded(businessId)

    const subscription = await query('SELECT plan FROM subscriptions WHERE business_id = $1', [
      businessId,
    ])
    const billingPlan = subscription.rows[0]?.plan || 'free'
    const plan = await getBusinessPlanKey(businessId)
    const maxDomains = await getDomainsLimitForPlan(plan)

    const countResult = await query(
      `SELECT COUNT(*)::int AS used
       FROM business_domains
       WHERE business_id = $1 AND status = 'active'`,
      [businessId],
    )
    const usedDomains = countResult.rows[0]?.used || 0

    return {
      plan,
      billingPlan,
      maxDomains,
      maxDomainsLabel: formatLimit(maxDomains),
      usedDomains,
      remainingDomains: Number.isFinite(maxDomains) ? Math.max(0, maxDomains - usedDomains) : null,
      canAdd: !Number.isFinite(maxDomains) || usedDomains < maxDomains,
    }
  },

  async listDomains(businessId, userId) {
    const membership = await assertBusinessAccess(businessId, userId)
    await ensureBusinessDomainsTable()
    await migrateWebsiteIfNeeded(businessId)

    const result = await query(
      `SELECT id, business_id, domain, is_primary, status, created_at, updated_at
       FROM business_domains
       WHERE business_id = $1 AND status = 'active'
       ORDER BY is_primary DESC, created_at ASC`,
      [businessId],
    )

    const limits = await this.getLimitInfo(businessId)
    return {
      domains: result.rows,
      limits: {
        ...limits,
        isOwner: Boolean(membership?.isOwner || membership?.role === 'owner'),
      },
    }
  },

  async assertWebsiteResolves(input) {
    return assertWebsiteResolves(input)
  },

  async addDomain(businessId, userId, { domain } = {}) {
    await assertBusinessOwner(businessId, userId)
    await ensureBusinessDomainsTable()
    await migrateWebsiteIfNeeded(businessId)

    const normalized = await assertWebsiteResolves(domain)
    const limits = await this.getLimitInfo(businessId)
    if (!limits.canAdd) {
      throw new AppError(
        `Your ${limits.plan} plan includes ${limits.maxDomainsLabel} domain${limits.maxDomains === 1 ? '' : 's'}. Upgrade to add more websites.`,
        403,
        'DOMAIN_LIMIT',
      )
    }

    const duplicate = await query(
      `SELECT id FROM business_domains WHERE business_id = $1 AND domain = $2 AND status = 'active'`,
      [businessId, normalized],
    )
    if (duplicate.rows[0]) {
      throw new AppError('This domain is already added', 409)
    }

    const countResult = await query(
      `SELECT COUNT(*)::int AS count FROM business_domains WHERE business_id = $1 AND status = 'active'`,
      [businessId],
    )
    const isPrimary = (countResult.rows[0]?.count || 0) === 0

    const inserted = await query(
      `INSERT INTO business_domains (business_id, domain, is_primary, status, created_by)
       VALUES ($1, $2, $3, 'active', $4)
       ON CONFLICT (business_id, domain) DO UPDATE
         SET status = 'active',
             is_primary = EXCLUDED.is_primary OR business_domains.is_primary,
             updated_at = NOW(),
             created_by = COALESCE(business_domains.created_by, EXCLUDED.created_by)
       RETURNING *`,
      [businessId, normalized, isPrimary, userId],
    )

    if (isPrimary) await syncPrimaryWebsite(businessId)
    return inserted.rows[0]
  },

  async setPrimaryDomain(businessId, userId, domainId) {
    await assertBusinessOwner(businessId, userId)
    await ensureBusinessDomainsTable()

    const domain = await query(
      `SELECT id FROM business_domains WHERE id = $1 AND business_id = $2 AND status = 'active'`,
      [domainId, businessId],
    )
    if (!domain.rows[0]) throw new AppError('Domain not found', 404)

    await query(
      `UPDATE business_domains SET is_primary = FALSE, updated_at = NOW()
       WHERE business_id = $1 AND status = 'active'`,
      [businessId],
    )
    const updated = await query(
      `UPDATE business_domains SET is_primary = TRUE, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [domainId],
    )
    await syncPrimaryWebsite(businessId)
    return updated.rows[0]
  },

  async removeDomain(businessId, userId, domainId) {
    await assertBusinessOwner(businessId, userId)
    await ensureBusinessDomainsTable()

    const domain = await query(
      `SELECT * FROM business_domains WHERE id = $1 AND business_id = $2 AND status = 'active'`,
      [domainId, businessId],
    )
    if (!domain.rows[0]) throw new AppError('Domain not found', 404)

    const remaining = await query(
      `SELECT COUNT(*)::int AS count FROM business_domains
       WHERE business_id = $1 AND status = 'active' AND id <> $2`,
      [businessId, domainId],
    )
    if ((remaining.rows[0]?.count || 0) === 0) {
      throw new AppError('Keep at least one domain, or replace it before removing this one', 400)
    }

    const wasPrimary = domain.rows[0].is_primary
    await query(`DELETE FROM business_domains WHERE id = $1`, [domainId])

    if (wasPrimary) {
      const next = await query(
        `SELECT id FROM business_domains
         WHERE business_id = $1 AND status = 'active'
         ORDER BY created_at ASC LIMIT 1`,
        [businessId],
      )
      if (next.rows[0]) {
        await query(`UPDATE business_domains SET is_primary = TRUE, updated_at = NOW() WHERE id = $1`, [
          next.rows[0].id,
        ])
      }
      await syncPrimaryWebsite(businessId)
    }

    return { success: true }
  },

  /** Keep domains table in sync when profile website is edited. */
  async syncFromWebsiteField(businessId, website, userId = null) {
    await ensureBusinessDomainsTable()
    if (!website || !String(website).trim()) return null

    let normalized
    try {
      normalized = normalizeDomainInput(website)
    } catch {
      return null
    }

    const existing = await query(
      `SELECT id FROM business_domains WHERE business_id = $1 AND domain = $2`,
      [businessId, normalized],
    )

    if (existing.rows[0]) {
      await query(
        `UPDATE business_domains SET is_primary = FALSE, updated_at = NOW()
         WHERE business_id = $1 AND status = 'active'`,
        [businessId],
      )
      await query(
        `UPDATE business_domains
         SET status = 'active', is_primary = TRUE, updated_at = NOW()
         WHERE id = $1`,
        [existing.rows[0].id],
      )
      return syncPrimaryWebsite(businessId)
    }

    const limits = await this.getLimitInfo(businessId)
    const countResult = await query(
      `SELECT COUNT(*)::int AS count FROM business_domains WHERE business_id = $1 AND status = 'active'`,
      [businessId],
    )
    const used = countResult.rows[0]?.count || 0

    if (used === 0) {
      await query(
        `INSERT INTO business_domains (business_id, domain, is_primary, status, created_by)
         VALUES ($1, $2, TRUE, 'active', $3)`,
        [businessId, normalized, userId],
      )
      return syncPrimaryWebsite(businessId)
    }

    if (!limits.canAdd) {
      // At limit: replace primary domain value instead of adding a new seat
      const primary = await query(
        `SELECT id FROM business_domains
         WHERE business_id = $1 AND status = 'active' AND is_primary = TRUE
         LIMIT 1`,
        [businessId],
      )
      if (primary.rows[0]) {
        await query(
          `UPDATE business_domains SET domain = $1, updated_at = NOW() WHERE id = $2`,
          [normalized, primary.rows[0].id],
        )
        return syncPrimaryWebsite(businessId)
      }
    }

    await query(
      `UPDATE business_domains SET is_primary = FALSE, updated_at = NOW()
       WHERE business_id = $1 AND status = 'active'`,
      [businessId],
    )
    await query(
      `INSERT INTO business_domains (business_id, domain, is_primary, status, created_by)
       VALUES ($1, $2, TRUE, 'active', $3)`,
      [businessId, normalized, userId],
    )
    return syncPrimaryWebsite(businessId)
  },
}
