import { Router } from 'express'
import { businessSitemapService } from '../services/businessSitemap.service.js'
import { sitemapService } from '../services/sitemap.service.js'
import { prerenderService } from '../services/prerender.service.js'
import { searchIndexService } from '../services/searchIndex.service.js'

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

export async function sendIndexNowKey(req, res, next) {
  try {
    const expected = `${searchIndexService.getKey()}.txt`
    const requested = String(req.params.keyFile || '')
    if (requested !== expected) {
      res.status(404).type('text').send('Not found')
      return
    }
    res
      .status(200)
      .set({
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      })
      .send(searchIndexService.keyFileBody())
  } catch (err) {
    next(err)
  }
}

router.get('/sitemap.xml', sendSitemap)
router.get('/business-sitemap.xml', sendBusinessSitemap)
router.get('/prerender/businesses/:slug', sendBusinessPrerender)
router.get('/businesses/:slug', sendBusinessPrerender)
router.get('/:keyFile', (req, res, next) => {
  if (!String(req.params.keyFile || '').endsWith('.txt')) return next()
  return sendIndexNowKey(req, res, next)
})

export default router
