import { Router } from 'express'
import { authenticate, authorize } from '../middleware/auth.js'
import { notificationService } from '../services/notification.service.js'

const router = Router()

router.get('/', authenticate, async (req, res, next) => {
  try {
    const notifications = await notificationService.getByUser(req.user.id)
    res.json({ success: true, data: notifications })
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

router.patch('/read-all', authenticate, async (req, res, next) => {
  try {
    await notificationService.markAllAsRead(req.user.id)
    res.json({ success: true, message: 'All notifications marked as read' })
  } catch (err) {
    next(err)
  }
})

export default router
