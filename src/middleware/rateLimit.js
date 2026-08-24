const buckets = new Map()

function prune(now) {
  if (buckets.size < 2000) return
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key)
  }
}

export function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, message = 'Too many attempts. Please try again later.' } = {}) {
  return (req, res, next) => {
    const now = Date.now()
    prune(now)
    const ip = req.ip || req.socket?.remoteAddress || 'unknown'
    const key = `${ip}:${req.baseUrl}${req.path}`
    const current = buckets.get(key)
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs })
      return next()
    }
    current.count += 1
    if (current.count > max) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
      res.set('Retry-After', String(retryAfter))
      return res.status(429).json({ success: false, message })
    }
    return next()
  }
}

export const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 12 })
export const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 8 })
export const verifyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 })
export const forgotLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 })
