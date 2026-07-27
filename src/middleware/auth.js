import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { query } from '../db/pool.js'
import { AppError } from '../utils/helpers.js'
import { isCrmRole, isSuperAdmin } from '../utils/roles.js'

export function authenticate(req, _res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError('Authentication required', 401))
  }

  const token = header.split(' ')[1]
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET)
    req.user = decoded
    next()
  } catch {
    next(new AppError('Invalid or expired token', 401))
  }
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

/** CRM login roles: super_admin, admin, viewer */
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

/** Viewers can read CRM data but cannot create/update/delete */
export function denyViewerWrites(req, _res, next) {
  if (req.user?.role === 'viewer' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next(new AppError('Viewers have read-only access', 403))
  }
  next()
}

export function optionalAuth(req, _res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return next()

  const token = header.split(' ')[1]
  try {
    req.user = jwt.verify(token, env.JWT_SECRET)
  } catch {
    // ignore invalid token for optional auth
  }
  next()
}
