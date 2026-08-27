import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { authenticate } from '../middleware/auth.js'
import { authLimiter, forgotLimiter, registerLimiter, verifyLimiter } from '../middleware/rateLimit.js'
import { authService } from '../services/auth.service.js'
import { AppError } from '../utils/helpers.js'
import { avatarUpload, buildAvatarPublicPath } from '../middleware/upload.js'

const router = Router()

router.post(
  '/register',
  registerLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
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
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password is required'),
    body('role').optional().isIn(['customer', 'business']).withMessage('Invalid account type'),
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

router.post(
  '/google',
  authLimiter,
  [body('credential').notEmpty().withMessage('Google credential is required')],
  validate,
  async (req, res, next) => {
    try {
      const result = await authService.loginWithGoogle(req.body.credential)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/verify-email',
  verifyLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('code').trim().matches(/^\d{6}$/).withMessage('Enter the 6-digit code from your email'),
    body('role').optional().isIn(['customer', 'business']).withMessage('Invalid account type'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await authService.verifyEmail(req.body)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/resend-verification',
  verifyLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('role').optional().isIn(['customer', 'business']).withMessage('Invalid account type'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await authService.resendVerificationCode(req.body.email, req.body.role)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/forgot-password',
  forgotLimiter,
  [
    body('email').isEmail().withMessage('Valid email required'),
    body('role').optional().isIn(['customer', 'business', 'crm']).withMessage('Invalid account type'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await authService.forgotPassword(req.body.email, req.body.role)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/reset-password',
  forgotLimiter,
  [
    body('token').notEmpty().withMessage('Token is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
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

// Change / add password (customer settings)
async function changePasswordHandler(req, res, next) {
  try {
    const result = await authService.changePassword(
      req.user.id,
      req.body.currentPassword,
      req.body.password,
    )
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
}

const changePasswordValidation = [
  body('currentPassword').optional({ values: 'falsy' }).isString(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
]

router.post(
  '/change-password',
  authenticate,
  authLimiter,
  changePasswordValidation,
  validate,
  changePasswordHandler,
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

router.post(
  '/me/avatar',
  authenticate,
  (req, res, next) => {
    avatarUpload.single('avatar')(req, res, (err) => {
      if (!err) return next()
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('Profile picture is too large. Maximum size is 5MB.', 400))
      }
      return next(err)
    })
  },
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw new AppError('Please upload a profile picture (PNG, JPG, or WEBP).', 400)
      }
      const avatarUrl = buildAvatarPublicPath(req.file.filename)
      const user = await authService.updateAvatar(req.user.id, avatarUrl)
      res.json({ success: true, data: user })
    } catch (err) {
      next(err)
    }
  },
)

router.delete('/me/avatar', authenticate, async (req, res, next) => {
  try {
    const user = await authService.updateAvatar(req.user.id, null)
    res.json({ success: true, data: user })
  } catch (err) {
    next(err)
  }
})

router.delete('/me', authenticate, async (req, res, next) => {
  try {
    const result = await authService.deleteAccount(req.user.id)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

export default router
