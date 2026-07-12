import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { AppError } from '../utils/helpers.js'

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
