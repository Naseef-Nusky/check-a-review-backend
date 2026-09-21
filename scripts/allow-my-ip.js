/**
 * Add your current public IPv4 to the DigitalOcean managed DB trusted sources.
 *
 * Required in .env:
 *   DIGITALOCEAN_TOKEN=dop_v1_...
 *   DO_DATABASE_ID=<cluster uuid from DO control panel>
 *
 * Usage:
 *   npm run db:allow-ip
 *
 * Optional:
 *   DO_ALLOW_IP_LABEL=dev-laptop   (description stored on the rule)
 *   DO_ALLOW_IP_REPLACE_LABEL=1    (remove older rules with the same description)
 */
import 'dotenv/config'

const TOKEN = process.env.DIGITALOCEAN_TOKEN
const CLUSTER_ID = process.env.DO_DATABASE_ID
const LABEL = process.env.DO_ALLOW_IP_LABEL || 'local-dev'
const REPLACE_SAME_LABEL = String(process.env.DO_ALLOW_IP_REPLACE_LABEL || '1') !== '0'
const API = 'https://api.digitalocean.com/v2'

function fail(message) {
  console.error(message)
  process.exit(1)
}

async function doFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  if (res.status === 204) return null

  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { raw: text }
  }

  if (!res.ok) {
    const detail = body?.message || body?.id || text || res.statusText
    fail(`DigitalOcean API ${res.status}: ${detail}`)
  }

  return body
}

async function getPublicIpv4() {
  const res = await fetch('https://api.ipify.org?format=json')
  if (!res.ok) fail(`Could not detect public IP (${res.status})`)
  const { ip } = await res.json()
  if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    fail(`Unexpected public IP response: ${ip}`)
  }
  return ip
}

function ruleKey(rule) {
  return `${rule.type}:${rule.value}`
}

async function main() {
  if (!TOKEN) {
    fail(
      'Missing DIGITALOCEAN_TOKEN in .env\n' +
        'Create a token at https://cloud.digitalocean.com/account/api/tokens (scopes: database read + update)',
    )
  }
  if (!CLUSTER_ID) {
    fail(
      'Missing DO_DATABASE_ID in .env\n' +
        'Find it in DigitalOcean → Databases → your cluster → Settings (UUID), or GET /v2/databases',
    )
  }

  const ip = await getPublicIpv4()
  console.log(`Public IP: ${ip}`)

  const current = await doFetch(`/databases/${CLUSTER_ID}/firewall`)
  const existing = Array.isArray(current?.rules) ? current.rules : []

  let next = existing.map((r) => ({
    type: r.type,
    value: r.value,
    ...(r.description ? { description: r.description } : {}),
  }))

  if (REPLACE_SAME_LABEL) {
    next = next.filter((r) => !(r.type === 'ip_addr' && r.description === LABEL))
  }

  const already = next.some((r) => r.type === 'ip_addr' && r.value === ip)
  if (!already) {
    next.push({ type: 'ip_addr', value: ip, description: LABEL })
  }

  // De-dupe by type:value
  const seen = new Set()
  next = next.filter((r) => {
    const key = ruleKey(r)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  if (already && existing.some((r) => r.type === 'ip_addr' && r.value === ip)) {
    console.log(`Already trusted: ${ip}`)
    console.log('No firewall changes needed. Retry npm run dev.')
    return
  }

  await doFetch(`/databases/${CLUSTER_ID}/firewall`, {
    method: 'PUT',
    body: JSON.stringify({ rules: next }),
  })

  console.log(`Trusted sources updated (${next.length} rules).`)
  console.log(`Allowed IP: ${ip} (${LABEL})`)
  console.log('Wait a few seconds, then run: npm run dev')
}

main().catch((err) => fail(err?.message || String(err)))
