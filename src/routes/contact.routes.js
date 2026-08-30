import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { emailService } from '../services/email.service.js'

const router = Router()

router.post(
  '/',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('subject').trim().notEmpty().withMessage('Subject is required'),
    body('message').trim().notEmpty().withMessage('Message is required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const payload = {
        name: String(req.body.name).trim(),
        email: String(req.body.email).trim().toLowerCase(),
        subject: String(req.body.subject).trim(),
        message: String(req.body.message).trim(),
      }

      await emailService.sendContactForm(payload)

      res.json({
        success: true,
        message: 'Thank you for contacting us. We will get back to you shortly.',
        data: payload,
      })
    } catch (err) {
      next(err)
    }
  },
)

export default router
