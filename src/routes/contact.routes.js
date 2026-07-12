import { Router } from 'express'
import { body } from 'express-validator'
import { validate } from '../middleware/validate.js'

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
      res.json({
        success: true,
        message: 'Thank you for contacting us. We will get back to you shortly.',
        data: { name: req.body.name, email: req.body.email, subject: req.body.subject },
      })
    } catch (err) {
      next(err)
    }
  },
)

export default router
