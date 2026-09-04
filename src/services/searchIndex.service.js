import { env } from '../config/env.js'
import { query } from '../db/pool.js'

const DEFAULT_KEY = 'car-indexnow-8f2c4a91e6b03d75'

function siteOrigin() {
  return String(process.env.PUBLIC_SITE_URL || env.PUBLIC_SITE_URL || 'https://checkareview.com').replace(
    /\/$/,
    '',
  )
}

function siteHost() {
  try {
    return new URL(siteOrigin()).host
  } catch {
    return 'checkareview.com'
  }
}

function indexNowKey() {
  return String(process.env.INDEXNOW_KEY || env.INDEXNOW_KEY || DEFAULT_KEY).trim() || DEFAULT_KEY
}

function businessUrl(business) {
  const slug = business?.slug || business?.id
  if (!slug) return null
  return `${siteOrigin()}/businesses/${encodeURIComponent(slug)}`
}

function runInBackground(label, work) {
  Promise.resolve()
    .then(work)
    .catch((err) => {
      console.error(`[search-index:${label}]`, err.message || err)
    })
}

export const searchIndexService = {
  getKey() {
    return indexNowKey()
  },

  keyFileBody() {
    return indexNowKey()
  },

  /**
   * Notify search engines (IndexNow: Bing, Yandex, etc.) about new/updated URLs.
   * Google mainly uses the live sitemap — IndexNow speeds up other engines and some Google discovery paths.
   */
  async submitUrls(urls = []) {
    const list = [...new Set((urls || []).filter(Boolean))]
    if (list.length === 0) return { submitted: 0 }

    const key = indexNowKey()
    const host = siteHost()
    const keyLocation = `${siteOrigin()}/${key}.txt`
    const payload = {
      host,
      key,
      keyLocation,
      urlList: list.slice(0, 10000),
    }

    const endpoints = [
      'https://api.indexnow.org/indexnow',
      'https://www.bing.com/indexnow',
      'https://yandex.com/indexnow',
    ]

    const results = []
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(payload),
        })
        results.push({ endpoint, status: res.status })
      } catch (err) {
        results.push({ endpoint, status: 0, error: err.message })
      }
    }

    return { submitted: list.length, keyLocation, results }
  },

  notifyBusinessPublished(business) {
    const url = businessUrl(business)
    if (!url) return
    runInBackground('business-published', () => this.submitUrls([url]))
  },

  /** One-time / on-demand: submit all published business URLs via IndexNow (batched). */
  async notifyAllPublishedBusinesses() {
    const result = await query(
      `SELECT slug, id
       FROM businesses
       WHERE status = 'published' AND slug IS NOT NULL AND slug <> ''
       ORDER BY updated_at DESC`,
    )

    const urls = result.rows.map((row) => businessUrl(row)).filter(Boolean)
    const batchSize = 100
    let submitted = 0
    const batches = []

    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize)
      const response = await this.submitUrls(batch)
      submitted += response.submitted
      batches.push(response)
    }

    return { total: urls.length, submitted, batches }
  },
}
