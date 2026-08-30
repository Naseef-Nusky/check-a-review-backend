import { Router } from 'express'
import { sitemapService } from '../services/sitemap.service.js'

const router = Router()

router.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const xml = await sitemapService.buildXml()
    res.type('application/xml').send(xml)
  } catch (err) {
    next(err)
  }
})

export default router
