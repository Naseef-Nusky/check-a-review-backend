import { Router } from 'express'
import {
  isSalesContactBody,
  validateContactFormBody,
  validateSimpleContactBody,
} from '../utils/contactForm.validation.js'
import { AppError } from '../utils/helpers.js'
import { emailService } from '../services/email.service.js'

const router = Router()

router.post('/', async (req, res, next) => {
  try {
    if (String(req.body.poweredBy || '').trim()) {
      res.json({
        success: true,
        message: 'Thank you for contacting us. We will get back to you shortly.',
      })
      return
    }

    if (isSalesContactBody(req.body)) {
      const { errors, isValid, payload } = validateContactFormBody(req.body)
      if (!isValid) {
        throw new AppError(errors.map((entry) => entry.message).join(', '), 400)
      }

      await emailService.sendContactSalesForm(payload)

      res.json({
        success: true,
        message: 'Thank you for contacting us. We will get back to you shortly.',
        data: payload,
      })
      return
    }

    const { errors, isValid, payload } = validateSimpleContactBody(req.body)
    if (!isValid) {
      throw new AppError(errors.map((entry) => entry.message).join(', '), 400)
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
})

export default router
