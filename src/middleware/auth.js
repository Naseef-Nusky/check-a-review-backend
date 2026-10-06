import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { query } from '../db/pool.js'
import { AppError } from '../utils/helpers.js'
import { isCrmRole, isSuperAdmin, canCrmWrite, canCrmCreateBusiness } from '../utils/roles.js'
import { ensureTokenVersionColumn } from '../utils/session.js'

async function loadActiveUser(decoded) {
  if (!decoded?.id) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED')
  await ensureTokenVersionColumn()
  const result = await query(
    `SELECT id, email, name, role, token_version
     FROM users
     WHERE id = $1`,
    [decoded.id],
  )
  if (result.rows.length === 0) throw new AppError('Invalid or expired token', 401, 'SESSION_EXPIRED')
  const dbUser = result.rows[0]
  if (decoded.role && dbUser.role !== decoded.role) {
    throw new AppError('Invalid or expired token', 401, 'SESSION_EXPIRED')
  }
  const tokenVersion = Number(dbUser.token_version || 0)
  const claimedVersion = Number(decoded.tv ?? 0)
  if (tokenVersion !== claimedVersion) {
    throw new AppError('Invalid or expired token', 401, 'SESSION_EXPIRED')
  }
  return {
    id: dbUser.id,
    email: dbUser.email,
    name: dbUser.name,
    role: dbUser.role,
    tv: tokenVersion,
  }
}

export function authenticate(req, _res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401, 'AUTH_REQUIRED'))
  }

  const token = header.split(' ')[1]
  ;(async () => {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET)
      req.user = await loadActiveUser(decoded)
      next()
    } catch (err) {
      if (err instanceof AppError) return next(err)
      next(new AppError('Invalid or expired token', 401, 'SESSION_EXPIRED'))
    }
  })()
}

export function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError('Access denied', 403))
    }
    next()
  }
}

/** Refresh CRM role from DB so promotions (admin → super_admin) apply without re-login */
export async function syncCrmRole(req, _res, next) {
  try {
    if (!req.user?.id) return next(new AppError('Authentication required', 401))
    const result = await query('SELECT id, email, name, role FROM users WHERE id = $1', [req.user.id])
    if (result.rows.length === 0) return next(new AppError('User not found', 401))
    const dbUser = result.rows[0]
    if (!isCrmRole(dbUser.role)) return next(new AppError('Access denied', 403))
    req.user = {
      ...req.user,
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      role: dbUser.role,
    }
    next()
  } catch (err) {
    next(err)
  }
}

/** CRM login roles: super_admin, admin, viewer, business_adder */
export function authorizeCrm(req, _res, next) {
  if (!req.user || !isCrmRole(req.user.role)) {
    return next(new AppError('Access denied', 403))
  }
  next()
}

/** Only super_admin can manage CRM staff accounts */
export function requireSuperAdmin(req, _res, next) {
  if (!req.user || !isSuperAdmin(req.user.role)) {
    return next(new AppError('Only super admin can manage CRM users', 403))
  }
  next()
}

function normalizeAdminPath(req) {
  return String(req.path || '').replace(/\/+$/, '') || '/'
}

/** True for create-business (and optional logo right after create). */
function isAllowedBusinessAdderWrite(req) {
  if (!canCrmCreateBusiness(req.user?.role) || canCrmWrite(req.user?.role)) return false
  const path = normalizeAdminPath(req)
  if (req.method === 'POST' && path === '/businesses') return true
  // Allow logo upload as part of the add-business flow
  if (req.method === 'POST' && /^\/businesses\/[^/]+\/logo$/.test(path)) return true
  return false
}

/**
 * Viewers: read-only.
 * Business adders: may create businesses (+ logo), everything else read-only.
 */
export function denyViewerWrites(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()

  const role = req.user?.role
  if (role === 'viewer') {
    return next(new AppError('Viewers have read-only access', 403))
  }
  if (role === 'business_adder') {
    if (isAllowedBusinessAdderWrite(req)) return next()
    return next(
      new AppError(
        'Business adder accounts can add businesses but cannot edit details, claims, or other CRM data',
        403,
      ),
    )
  }
  next()
}

export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return next()

  const token = header.split(' ')[1]
  ;(async () => {
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET)
      req.user = await loadActiveUser(decoded)
    } catch {
      // ignore invalid token for optional auth
    }
    next()
  })()
}
