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

router.get('/businesses/:idOrSlug/availability', async (req, res, next) => {
  try {
    const data = await claimService.getClaimAvailability(req.params.idOrSlug)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post(
  '/verify-email',
  [
    body('token')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Verification code is required'),
    body('code')
      .optional()
      .trim()
      .notEmpty()
      .withMessage('Verification code is required'),
  ],
  validate,
  async (req, res, next) => {
    try {
      const tokenOrCode = String(req.body.code || req.body.token || '').trim()
      if (!tokenOrCode) {
        throw new AppError('Enter the 6-digit verification code from your email', 400)
      }
      const result = await claimService.verifyClaimEmail(tokenOrCode)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.post(
  '/resend-verification',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('businessId').optional().trim(),
    body('businessSlug').optional().trim(),
  ],
  validate,
  async (req, res, next) => {
    try {
      const businessIdOrSlug = req.body.businessId || req.body.businessSlug || null
      const result = await claimService.resendClaimVerification(req.body.email, businessIdOrSlug)
      res.json({ success: true, data: result })
    } catch (err) {
      next(err)
    }
  },
)

router.get('/verify-email', async (req, res, next) => {
  try {
    const token = String(req.query.token || req.query.code || '').trim()
    if (!token) {
      res.status(400).json({ success: false, message: 'Verification code is required' })
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
