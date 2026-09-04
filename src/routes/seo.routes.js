import { Router } from 'express'
import { businessSitemapService } from '../services/businessSitemap.service.js'
import { sitemapService } from '../services/sitemap.service.js'

const router = Router()

function sendXml(res, xml) {
  res
    .status(200)
    .set({
      'Content-Type': 'application/xml; charset=utf-8',
      // Short cache so Google always sees newly published businesses
      'Cache-Control': 'public, max-age=300',
    })
    .send(xml)
}

export async function sendSitemap(_req, res, next) {
  try {
    const xml = await sitemapService.buildXml()
    sendXml(res, xml)
  } catch (err) {
    next(err)
  }
}

export async function sendBusinessSitemap(_req, res, next) {
  try {
    const xml = businessSitemapService.buildXml()
    sendXml(res, xml)
  } catch (err) {
    next(err)
  }
}

router.get('/sitemap.xml', sendSitemap)
router.get('/business-sitemap.xml', sendBusinessSitemap)

export default router
