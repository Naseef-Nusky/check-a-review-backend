import { Router } from 'express'
import { authenticate, authorize, optionalAuth } from '../middleware/auth.js'
import { teamService } from '../services/team.service.js'
import { authService } from '../services/auth.service.js'

const router = Router()

router.get('/invite/:token', async (req, res, next) => {
  try {
    const invite = await teamService.getInviteByToken(req.params.token)
    res.json({
      success: true,
      data: {
        email: invite.email,
        businessName: invite.business_name,
        hasExistingAccount: Boolean(invite.existing_user_id),
      },
    })
  } catch (err) {
    next(err)
  }
})

router.post('/invite/:token/accept', optionalAuth, async (req, res, next) => {
  try {
    const userId = req.user?.role === 'business' ? req.user.id : null
    const result = await teamService.acceptInvite(req.params.token, {
      userId,
      name: req.body?.name,
      password: req.body?.password,
    })

    if (!userId && req.body?.password) {
      const profile = await authService.getProfile(result.userId)
      const login = await authService.login({
        email: profile.email,
        password: req.body.password,
        role: 'business',
      })
      return res.json({ success: true, data: { member: result.member, ...login } })
    }

    res.json({ success: true, data: result })
  } catch (err) {
    next(err)
  }
})

router.get('/:businessId', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const data = await teamService.listMembers(req.params.businessId, req.user.id)
    res.json({ success: true, data })
  } catch (err) {
    next(err)
  }
})

router.post('/:businessId/invite', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const member = await teamService.createMember(req.params.businessId, req.user.id, {
      email: req.body?.email,
      name: req.body?.name,
      password: req.body?.password,
    })
    res.status(201).json({ success: true, data: member })
  } catch (err) {
    next(err)
  }
})

router.post('/:businessId/members', authenticate, authorize('business'), async (req, res, next) => {
  try {
    const member = await teamService.createMember(req.params.businessId, req.user.id, {
      email: req.body?.email,
      name: req.body?.name,
      password: req.body?.password,
    })
    res.status(201).json({ success: true, data: member })
  } catch (err) {
    next(err)
  }
})

router.delete(
  '/:businessId/members/:memberId',
  authenticate,
  authorize('business'),
  async (req, res, next) => {
    try {
      const data = await teamService.removeMember(
        req.params.businessId,
        req.user.id,
        req.params.memberId,
      )
      res.json({ success: true, data })
    } catch (err) {
      next(err)
    }
  },
)

export default router
