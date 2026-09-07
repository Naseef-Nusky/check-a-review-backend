import { Router } from 'express'
import { adminService } from '../services/admin.service.js'
import { ensureSiteSeoColumns, normalizeSeoExtraTagsInput } from '../utils/seoMeta.js'

const router = Router()

/** Public site SEO (homepage / default brand meta) for the consumer frontend. */
router.get('/site', async (_req, res, next) => {
  try {
    await ensureSiteSeoColumns()
    const settings = await adminService.getSettings()
    res.json({
      success: true,
      data: {
        title: settings.seo_title || 'Check A Review | Trusted customer reviews & business ratings',
        description:
          settings.seo_description ||
          'Check A Review — read verified customer reviews, compare business ratings, and find companies you can trust.',
        keywords:
          settings.seo_keywords ||
          'check a review, checkareview, customer reviews, company reviews, business reviews, check reviews',
        extraTags: normalizeSeoExtraTagsInput(settings.seo_extra_tags),
        siteName: settings.site_name || 'Check A Review',
      },
    })
  } catch (err) {
    next(err)
  }
})

export default router
