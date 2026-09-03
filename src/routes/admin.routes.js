import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { authenticate, authorizeCrm, requireSuperAdmin, denyViewerWrites, syncCrmRole } from '../middleware/auth.js'
import { adminService } from '../services/admin.service.js'
import { reviewService } from '../services/review.service.js'
import { businessService } from '../services/business.service.js'
import { AppError } from '../utils/helpers.js'
import { logoUploadMemory } from '../middleware/upload.js'

const router = Router()

router.use(authenticate, syncCrmRole, authorizeCrm, denyViewerWrites)

router.get('/dashboard', async (_req, res, next) => {
  try {
    await adminService.ensureCrmRoleConstraint()
    const stats = await adminService.getDashboardStats()
    res.json({ success: true, data: stats })
  } catch (err) {
    next(err)
  }
})

router.get('/users', async (_req, res, next) => {
  try {
    const users = await adminService.getUsers()
    res.json({ success: true, data: users })
  } catch (err) {
    next(err)
  }
})

router.patch(
  '/users/:id',
  [
    body('name').optional({ checkFalsy: true }).trim().notEmpty().withMessage('Name cannot be empty'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Valid email required'),
    body('password').optional({ checkFalsy: true }).isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('email_verified').optional().isBoolean().withMessage('email_verified must be boolean'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const user = await adminService.updateUser(req.params.id, req.body)
      res.json({ success: true, data: user })
    } catch (err) {
      next(err)
    }
  },
)

router.delete('/users/:id', async (req, res, next) => {
  try {
    const result = await adminService.deleteUser(req.params.id)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.get('/staff', async (_req, res, next) => {
  try {
    const staff = await adminService.getStaff()
    res.json({ success: true, data: staff })
  } catch (err) {
    next(err)
  }
})

router.post(
  '/staff',
  requireSuperAdmin,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role').isIn(['admin', 'viewer']).withMessage('Role must be admin or viewer'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const staff = await adminService.createStaff(req.body)
      res.status(201).json({ success: true, data: staff })
    } catch (err) {
      next(err)
    }
  },
)

router.patch(
  '/staff/:id',
  requireSuperAdmin,
  [
    body('name').optional({ checkFalsy: true }).trim().notEmpty().withMessage('Name cannot be empty'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Valid email required'),
    body('password').optional({ checkFalsy: true }).isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('role').optional().isIn(['admin', 'viewer']).withMessage('Role must be admin or viewer'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const staff = await adminService.updateStaff(req.params.id, req.body, req.user.id)
      res.json({ success: true, data: staff })
    } catch (err) {
      next(err)
    }
  },
)

router.delete('/staff/:id', requireSuperAdmin, async (req, res, next) => {
  try {
    const result = await adminService.deleteStaff(req.params.id, req.user.id)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.get('/businesses', async (_req, res, next) => {
  try {
    const businesses = await adminService.getBusinesses()
    res.json({ success: true, data: businesses })
  } catch (err) {
    next(err)
  }
})

router.get('/businesses/:id', async (req, res, next) => {
  try {
    const business = await adminService.getBusinessById(req.params.id)
    res.json({ success: true, data: business })
  } catch (err) {
    next(err)
  }
})

router.patch(
  '/businesses/:id',
  [
    body('name').optional().trim().notEmpty().withMessage('Business name cannot be empty'),
    body('category').optional().trim().notEmpty().withMessage('Category cannot be empty'),
    body('owner_email').optional().isEmail().withMessage('Owner email must be valid'),
    body('email').optional({ nullable: true }).isEmail().withMessage('Public email must be valid'),
    body('website').optional({ nullable: true }).isString().withMessage('Website must be a string'),
    body('phone').optional({ nullable: true }).isString().withMessage('Phone must be a string'),
    body('description').optional({ nullable: true }).isString().withMessage('Description must be a string'),
    body('address').optional({ nullable: true }).isString().withMessage('Address must be a string'),
    body('owner_name').optional({ nullable: true }).isString().withMessage('Owner name must be a string'),
    body('plan').optional().isIn(['free', 'starter', 'plus', 'premium']).withMessage('Invalid plan'),
    body('subscription_status')
      .optional()
      .isIn(['active', 'cancelled', 'past_due', 'trialing'])
      .withMessage('Invalid subscription status'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const business = await adminService.updateBusiness(req.params.id, req.body)
      res.json({ success: true, data: business })
    } catch (err) {
      next(err)
    }
  },
)

router.delete('/businesses/:id', async (req, res, next) => {
  try {
    const result = await adminService.deleteBusiness(req.params.id)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.get('/categories', async (_req, res, next) => {
  try {
    const categories = await adminService.getCategories()
    res.json({ success: true, data: categories })
  } catch (err) {
    next(err)
  }
})

router.post(
  '/categories/main',
  [body('name').trim().notEmpty().withMessage('Main category name is required')],
  validate,
  async (req, res, next) => {
    try {
      const category = await adminService.createMainCategory(req.body.name)
      res.json({ success: true, data: category })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/categories/sub',
  [
    body('mainCategoryId').notEmpty().withMessage('Main category is required'),
    body('name').trim().notEmpty().withMessage('Subcategory name is required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const category = await adminService.createSubCategory(req.body.mainCategoryId, req.body.name)
      res.json({ success: true, data: category })
    } catch (err) {
      next(err)
    }
  },
)

router.patch(
  '/categories/main/:id',
  [body('name').trim().notEmpty().withMessage('Main category name is required')],
  validate,
  async (req, res, next) => {
    try {
      const category = await adminService.updateMainCategory(req.params.id, req.body.name)
      res.json({ success: true, data: category })
    } catch (err) {
      next(err)
    }
  },
)

router.patch(
  '/categories/sub/:id',
  [
    body('name').optional().trim().notEmpty().withMessage('Subcategory name is required'),
    body('mainCategoryId').optional().notEmpty().withMessage('Main category is required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const category = await adminService.updateSubCategory(req.params.id, {
        name: req.body.name,
        mainCategoryId: req.body.mainCategoryId,
      })
      res.json({ success: true, data: category })
    } catch (err) {
      next(err)
    }
  },
)

router.delete('/categories/main/:id', async (req, res, next) => {
  try {
    const result = await adminService.deleteMainCategory(req.params.id)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.delete('/categories/sub/:id', async (req, res, next) => {
  try {
    const result = await adminService.deleteSubCategory(req.params.id)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.post('/categories/seed', async (_req, res, next) => {
  try {
    const result = await adminService.seedCategories()
    const categories = await adminService.getCategories()
    res.json({ success: true, data: { ...result, categories } })
  } catch (err) {
    next(err)
  }
})

router.post('/categories/sync-businesses', async (_req, res, next) => {
  try {
    const result = await adminService.syncBusinessCategories()
    const categories = await adminService.getCategories()
    res.json({ success: true, data: { ...result, categories } })
  } catch (err) {
    next(err)
  }
})

router.post(
  '/categories',
  [body('name').trim().notEmpty().withMessage('Category name is required')],
  validate,
  async (req, res, next) => {
    try {
      const category = await adminService.createMainCategory(req.body.name)
      res.json({ success: true, data: category })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/businesses',
  [
    body('name').trim().notEmpty().withMessage('Business name is required'),
    body('email').isEmail().withMessage('Owner email must be valid'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('category').trim().notEmpty().withMessage('Category is required'),
    body('website').optional({ nullable: true }).isString().withMessage('Website must be a string'),
    body('phone').optional({ nullable: true }).isString().withMessage('Phone must be a string'),
    body('description').optional({ nullable: true }).isString().withMessage('Description must be a string'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const business = await adminService.createBusiness(req.body)
      res.json({ success: true, data: business })
    } catch (err) {
      next(err)
    }
  },
)

router.post('/businesses/:id/logo', (req, res, next) => {
  logoUploadMemory.single('logo')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('Logo file is too large. Maximum size is 2MB.', 400))
      }
      return next(err)
    }
    try {
      if (!req.file?.buffer) throw new AppError('Please upload a logo image (PNG, JPG, or WEBP).', 400)
      await adminService.setBusinessLogo(req.params.id, {
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
      })
      const business = await adminService.getBusinessById(req.params.id)
      res.json({ success: true, data: business })
    } catch (error) {
      next(error)
    }
  })
})

router.delete('/businesses/:id/logo', async (req, res, next) => {
  try {
    const business = await adminService.removeBusinessLogo(req.params.id)
    res.json({ success: true, data: business })
  } catch (err) {
    next(err)
  }
})

router.get('/reviews', async (_req, res, next) => {
  try {
    const reviews = await adminService.getAllReviews()
    res.json({ success: true, data: reviews })
  } catch (err) {
    next(err)
  }
})

router.get('/reviews/flagged', async (_req, res, next) => {
  try {
    const reviews = await reviewService.getFlagged()
    res.json({ success: true, data: reviews })
  } catch (err) {
    next(err)
  }
})

router.get('/businesses-pending', async (_req, res, next) => {
  try {
    const businesses = await businessService.getPending()
    res.json({ success: true, data: businesses })
  } catch (err) {
    next(err)
  }
})

router.patch(
  '/businesses/:id/moderate',
  [body('status').isIn(['published', 'rejected', 'pending']).withMessage('Invalid status')],
  validate,
  async (req, res, next) => {
    try {
      const business = await businessService.moderate(req.params.id, req.body.status)
      res.json({ success: true, data: business })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/reviews/:id', async (req, res, next) => {
  try {
    const review = await adminService.getReviewById(req.params.id)
    res.json({ success: true, data: review })
  } catch (err) {
    next(err)
  }
})

router.patch(
  '/reviews/:id/moderate',
  [body('status').isIn(['published', 'rejected', 'reported']).withMessage('Invalid status')],
  validate,
  async (req, res, next) => {
    try {
      const review = await reviewService.moderate(req.params.id, req.body.status)
      res.json({ success: true, data: review })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/subscriptions', async (_req, res, next) => {
  try {
    const subscriptions = await adminService.getSubscriptions()
    res.json({ success: true, data: subscriptions })
  } catch (err) {
    next(err)
  }
})

router.get('/payments', async (_req, res, next) => {
  try {
    const data = await adminService.getPayments()
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/billing-status', async (_req, res, next) => {
  try {
    const data = await adminService.getSquareBillingStatus()
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.get('/businesses/:id/payments', async (req, res, next) => {
  try {
    const payments = await adminService.getBusinessPayments(req.params.id)
    res.json({ success: true, data: payments })
  } catch (err) {
    next(err)
  }
})

router.get('/settings', async (_req, res, next) => {
  try {
    const settings = await adminService.getSettings()
    res.json({ success: true, data: settings })
  } catch (err) {
    next(err)
  }
})

router.put('/settings', async (req, res, next) => {
  try {
    const settings = await adminService.updateSettings(req.body)
    res.json({ success: true, data: settings })
  } catch (err) {
    next(err)
  }
})

router.post('/settings/logo', (req, res, next) => {
  logoUploadMemory.single('logo')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new AppError('Logo file is too large. Maximum size is 2MB.', 400))
      }
      return next(err)
    }
    try {
      if (!req.file?.buffer) throw new AppError('Please upload a logo image (PNG, JPG, or WEBP).', 400)
      const settings = await adminService.updateSiteLogoFromUpload({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
      })
      res.json({ success: true, data: settings })
    } catch (error) {
      next(error)
    }
  })
})

router.delete('/settings/logo', async (_req, res, next) => {
  try {
    const settings = await adminService.removeSiteLogo()
    res.json({ success: true, data: settings })
  } catch (err) {
    next(err)
  }
})

router.get('/pricing', async (_req, res, next) => {
  try {
    const pricing = await adminService.getBusinessPricingContent()
    res.json({ success: true, data: pricing })
  } catch (err) {
    next(err)
  }
})

router.put('/pricing', async (req, res, next) => {
  try {
    const pricing = await adminService.updateBusinessPricingContent(req.body)
    res.json({ success: true, data: pricing })
  } catch (err) {
    next(err)
  }
})

router.get('/billing-plans', async (_req, res, next) => {
  try {
    const data = await adminService.listBillingPlans()
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.put('/billing-plans/:key', async (req, res, next) => {
  try {
    const plan = await adminService.updateBillingPlan(req.params.key, req.body)
    res.json({ success: true, data: plan })
  } catch (err) {
    next(err)
  }
})

router.post('/billing-plans/:key/sync', async (req, res, next) => {
  try {
    const plan = await adminService.syncBillingPlan(req.params.key)
    res.json({ success: true, data: plan })
  } catch (err) {
    next(err)
  }
})

router.post('/billing-plans/sync-all', async (_req, res, next) => {
  try {
    const plans = await adminService.syncAllBillingPlans()
    res.json({ success: true, data: plans })
  } catch (err) {
    next(err)
  }
})

export default router
