import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { authenticate } from '../middleware/auth.js'
import { authService } from '../services/auth.service.js'

const router = Router()

router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('role').isIn(['customer', 'business']).withMessage('Role must be customer or business'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await authService.register(req.body)
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await authService.login(req.body)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.post('/verify-email', async (req, res, next) => {
  try {
    const result = await authService.verifyEmail(req.body.token)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.post(
  '/forgot-password',
  [body('email').isEmail().withMessage('Valid email required')],
  validate,
  async (req, res, next) => {
    try {
      const result = await authService.forgotPassword(req.body.email)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('Token is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await authService.resetPassword(req.body.token, req.body.password)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await authService.getProfile(req.user.id)
    res.json({ success: true, data: user })
  } catch (err) {
    next(err)
  }
})

router.put(
  '/me',
  authenticate,
  [body('name').optional().trim().notEmpty(), body('bio').optional()],
  validate,
  async (req, res, next) => {
    try {
      const user = await authService.updateProfile(req.user.id, req.body)
      res.json({ success: true, data: user })
    } catch (err) {
      next(err)
    }
  },
)

export default router
