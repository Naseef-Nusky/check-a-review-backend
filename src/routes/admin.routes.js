import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { authenticate, authorize } from '../middleware/auth.js'
import { adminService } from '../services/admin.service.js'
import { reviewService } from '../services/review.service.js'

const router = Router()

router.use(authenticate, authorize('admin'))

router.get('/dashboard', async (_req, res, next) => {
  try {
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

router.get('/businesses', async (_req, res, next) => {
  try {
    const businesses = await adminService.getBusinesses()
    res.json({ success: true, data: businesses })
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
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
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
    const payments = await adminService.getPayments()
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

export default router
