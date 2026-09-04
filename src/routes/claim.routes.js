import path from 'path'
import { Router } from 'express'
import { body, param } from 'express-validator'
import { validate } from '../middleware/validate.js'
import { claimAttachmentUpload, claimsDir } from '../middleware/upload.js'
import { claimService } from '../services/claim.service.js'
import { AppError } from '../utils/helpers.js'

const router = Router()

function handleClaimUpload(req, res, next) {
  claimAttachmentUpload.array('attachments', 5)(req, res, (err) => {
    if (!err) return next()
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Each attachment must be 8MB or smaller', 400))
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(new AppError('You can upload up to 5 attachments', 400))
    }
    return next(err)
  })
}

router.post(
  '/businesses/:idOrSlug/claim',
  handleClaimUpload,
  [
    param('idOrSlug').trim().notEmpty(),
    body('fullName').trim().notEmpty().withMessage('Full name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('phone').trim().notEmpty().withMessage('Phone number is required'),
    body('jobTitle').trim().notEmpty().withMessage('Job title is required'),
    body('relationship').trim().notEmpty().withMessage('Relationship is required'),
    body('verificationInfo').trim().notEmpty().withMessage('Verification information is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const result = await claimService.submitClaim(req.params.idOrSlug, req.body, req.files || [])
      res.status(201).json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/verify-email',
  [body('token').trim().notEmpty().withMessage('Verification token is required')],
  validate,
  async (req, res, next) => {
    try {
      const result = await claimService.verifyClaimEmail(req.body.token)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/verify-email', async (req, res, next) => {
  try {
    const token = String(req.query.token || '').trim()
    if (!token) {
      res.status(400).json({ success: false, message: 'Verification token is required' })
      return
    }
    const result = await claimService.verifyClaimEmail(token)
    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

export { claimsDir }
export default router
