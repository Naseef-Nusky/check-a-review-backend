import { Router } from 'express'
import { businessSitemapService } from '../services/businessSitemap.service.js'
import { sitemapService } from '../services/sitemap.service.js'

const router = Router()

export async function sendSitemap(_req, res, next) {
  try {
    const xml = await sitemapService.buildXml()
    res.type('application/xml').charset('utf-8').send(xml)
  } catch (err) {
    next(err)
  }
}

export async function sendBusinessSitemap(_req, res, next) {
  try {
    const xml = businessSitemapService.buildXml()
    res.type('application/xml').charset('utf-8').send(xml)
  } catch (err) {
    next(err)
  }
}

router.get('/sitemap.xml', sendSitemap)
router.get('/business-sitemap.xml', sendBusinessSitemap)

export default router
