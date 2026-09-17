/** Honeypot field names bots often fill. Humans must leave these empty. */
const HONEYPOT_FIELDS = ['poweredBy', 'companyUrl', 'fax', 'website', 'url']

/**
 * Silent spam accept: return true when the request should be discarded
 * without sending email (still return HTTP 200 so bots learn nothing).
 */
export function isContactSpam(body = {}) {
  for (const field of HONEYPOT_FIELDS) {
    if (String(body[field] || '').trim()) return true
  }

  const startedAt = Number(body.formStartedAt)
  if (Number.isFinite(startedAt) && startedAt > 0) {
    const elapsedMs = Date.now() - startedAt
    // Submitted in under 2.5s — almost always a bot
    if (elapsedMs >= 0 && elapsedMs < 2500) return true
    // Form "started" more than 24h ago — stale/replay
    if (elapsedMs > 24 * 60 * 60 * 1000) return true
  }

  const name = String(body.name || `${body.firstName || ''} ${body.lastName || ''}`).trim()
  const subject = String(body.subject || '').trim()
  const message = String(body.message || '').trim()
  const companyName = String(body.companyName || '').trim()

  if (looksLikeBotToken(name) || looksLikeBotToken(subject) || looksLikeBotToken(companyName)) {
    return true
  }

  // Subject and message identical random tokens
  if (subject && message && subject === message && looksLikeBotToken(subject)) return true

  // Message is only a random token with no spaces
  if (message && !/\s/.test(message) && looksLikeBotToken(message)) return true

  return false
}

/**
 * Detect gibberish like "tqOlvNLGWSMfDpfJhmrSqK" / "1Wk263VPm8".
 * Real subjects usually have spaces or readable words.
 */
export function looksLikeBotToken(text) {
  const t = String(text || '').trim()
  if (!t || t.length < 8) return false
  if (/\s/.test(t)) return false
  if (!/^[A-Za-z0-9_-]+$/.test(t)) return false

  const hasDigit = /\d/.test(t)
  const hasLower = /[a-z]/.test(t)
  const hasUpper = /[A-Z]/.test(t)

  // Mixed digits + letters, no spaces (classic bot subject)
  if (hasDigit && (hasLower || hasUpper) && t.length >= 8) return true

  // Mixed case blob without word breaks
  if (hasLower && hasUpper && t.length >= 10 && !/^[A-Z][a-z]+(?:[A-Z][a-z]+)?$/.test(t)) {
    return true
  }

  // Very low vowel ratio in letter-only blobs
  const letters = t.replace(/[^a-zA-Z]/g, '')
  if (letters.length >= 10) {
    const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length
    if (vowels / letters.length < 0.22) return true
  }

  return false
}
