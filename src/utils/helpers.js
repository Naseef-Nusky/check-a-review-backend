export class AppError extends Error {
  constructor(message, statusCode = 500, code = null) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = true
    this.code = code
  }
}

export function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function omitPassword(user) {
  return publicUser(user)
}

export function publicUser(user) {
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    bio: user.bio ?? null,
    avatar_url: user.avatar_url ?? null,
    email_verified: Boolean(user.email_verified),
    has_password: Boolean(user.password_hash),
    created_at: user.created_at,
  }
}

export function safeInternalPath(value, fallback = '/') {
  const path = String(value || '')
  if (!/^\/[A-Za-z0-9/_-]*$/.test(path) || path.startsWith('//')) return fallback
  return path
}

export function paginate(query) {
  const page = Math.max(1, parseInt(query.page || '1', 10))
  const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)))
  const offset = (page - 1) * limit
  return { page, limit, offset }
}
