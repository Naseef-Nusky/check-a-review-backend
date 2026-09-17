import { Router } from 'express'
import {
  isSalesContactBody,
  validateContactFormBody,
  validateSimpleContactBody,
} from '../utils/contactForm.validation.js'
import { isContactSpam } from '../utils/contactSpam.js'
import { AppError } from '../utils/helpers.js'
import { emailService } from '../services/email.service.js'
import { contactLimiter } from '../middleware/rateLimit.js'

const router = Router()

const OK_MESSAGE = 'Thank you for contacting us. We will get back to you shortly.'

function silentOk(res) {
  res.json({ success: true, message: OK_MESSAGE })
}

router.post('/', contactLimiter, async (req, res, next) => {
  try {
    // Honeypot / gibberish / too-fast submit — pretend success, do not email
    if (isContactSpam(req.body)) {
      silentOk(res)
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
        message: OK_MESSAGE,
        data: payload,
      })
      return
    }

    const { errors, isValid, payload } = validateSimpleContactBody(req.body)
    if (!isValid) {
      throw new AppError(errors.map((entry) => entry.message).join(', '), 400)
    }

    // Extra subject check after normalize (bots often only spam this field)
    if (isContactSpam({ subject: payload.subject, name: payload.name, message: payload.message })) {
      silentOk(res)
      return
    }

    await emailService.sendContactForm(payload)

    res.json({
      success: true,
      message: OK_MESSAGE,
      data: payload,
    })
  } catch (err) {
    next(err)
  }
})

export default router
