import { Router } from 'express'
import { businessSitemapService } from '../services/businessSitemap.service.js'
import { sitemapService } from '../services/sitemap.service.js'
import { prerenderService } from '../services/prerender.service.js'

const router = Router()

function sendXml(res, xml) {
  res
    .status(200)
    .set({
      'Content-Type': 'application/xml; charset=utf-8',
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

export async function sendBusinessPrerender(req, res, next) {
  try {
    const html = await prerenderService.renderBusinessPage(req.params.slug)
    res
      .status(200)
      .set({
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'X-Robots-Tag': 'index, follow',
      })
      .send(html)
  } catch (err) {
    next(err)
  }
}

router.get('/sitemap.xml', sendSitemap)
router.get('/business-sitemap.xml', sendBusinessSitemap)
router.get('/prerender/businesses/:slug', sendBusinessPrerender)
router.get('/businesses/:slug', sendBusinessPrerender)

export default router
