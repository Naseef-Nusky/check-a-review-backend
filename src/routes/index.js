import { Router } from 'express'
import authRoutes from './auth.routes.js'
import businessRoutes from './business.routes.js'
import reviewRoutes from './review.routes.js'
import notificationRoutes from './notification.routes.js'
import subscriptionRoutes from './subscription.routes.js'
import adminRoutes from './admin.routes.js'
import contactRoutes from './contact.routes.js'
import widgetRoutes from './widget.routes.js'
import mediaRoutes from './media.routes.js'
import teamRoutes from './team.routes.js'
import domainRoutes from './domain.routes.js'
import { sendSitemap, sendBusinessSitemap } from './seo.routes.js'

const router = Router()

router.get('/health', (_req, res) => {
  res.json({ success: true, message: 'Check A Review API is running', timestamp: new Date().toISOString() })
})

router.get('/sitemap.xml', sendSitemap)
router.get('/business-sitemap.xml', sendBusinessSitemap)

router.use('/auth', authRoutes)
router.use('/media', mediaRoutes)
router.use('/businesses', businessRoutes)
router.use('/reviews', reviewRoutes)
router.use('/notifications', notificationRoutes)
router.use('/subscriptions', subscriptionRoutes)
router.use('/team', teamRoutes)
router.use('/domains', domainRoutes)
router.use('/admin', adminRoutes)
router.use('/contact', contactRoutes)
router.use('/widget', widgetRoutes)

export default router
