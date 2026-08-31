import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { AppError } from '../utils/helpers.js'
import { notificationService } from '../services/notification.service.js'

const READ_BY_TYPE = new Set(['pending_business', 'pending_review'])

const router = Router()

router.get('/', authenticate, async (req, res, next) => {
  try {
    const notifications = await notificationService.getByUser(req.user.id)
    res.json({ success: true, data: notifications })
  } catch (err) {
    next(err)
  }
})

router.get('/unread-count', authenticate, async (req, res, next) => {
  try {
    const count = await notificationService.getUnreadCount(req.user.id)
    res.json({ success: true, data: { count } })
  } catch (err) {
    next(err)
  }
})

router.patch('/read-all', authenticate, async (req, res, next) => {
  try {
    await notificationService.markAllAsRead(req.user.id)
    res.json({ success: true, message: 'All notifications marked as read' })
  } catch (err) {
    next(err)
  }
})

router.patch('/read-by-type/:type', authenticate, async (req, res, next) => {
  try {
    const type = String(req.params.type || '').trim()
    if (!READ_BY_TYPE.has(type)) {
      throw new AppError('Invalid notification type', 400)
    }
    await notificationService.markAsReadByType(req.user.id, type)
    res.json({ success: true, message: 'Notifications marked as read' })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    await notificationService.markAsRead(req.params.id, req.user.id)
    res.json({ success: true, message: 'Notification marked as read' })
  } catch (err) {
    next(err)
  }
})

export default router
