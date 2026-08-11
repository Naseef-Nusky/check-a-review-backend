import { Router } from 'express'
import { authenticate, authorize } from '../middleware/auth.js'
import { domainService } from '../services/domain.service.js'

const router = Router()

router.get('/:businessId', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const data = await domainService.listDomains(req.params.businessId, req.user.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:businessId', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const domain = await domainService.addDomain(req.params.businessId, req.user.id, {
      domain: req.body?.domain || req.body?.website,
    })
    res.status(201).json({ success: true, data: domain })
  } catch (err) {
    next(err)
  }
})

router.patch(
  '/:businessId/:domainId/primary',
  authenticate,
  authorize('business'),
  async (req, res, next) => {
    try {
      const domain = await domainService.setPrimaryDomain(
        req.params.businessId,
        req.user.id,
        req.params.domainId,
      )
      res.json({ success: true, data: domain })
    } catch (err) {
      next(err)
    }
  },
)

router.delete(
  '/:businessId/:domainId',
  authenticate,
  authorize('business'),
  async (req, res, next) => {
    try {
      const data = await domainService.removeDomain(
        req.params.businessId,
        req.user.id,
        req.params.domainId,
      )
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },
)

export default router
