import { Router } from 'express'
import { MEDIA_KIND, mediaService } from '../services/media.service.js'

const router = Router()

function sendImage(res, image) {
  if (!image?.bytes) {
    return res.status(404).json({ success: false, message: 'Image not found' })
  }

  const payload = Buffer.isBuffer(image.bytes) ? image.bytes : Buffer.from(image.bytes)
  res.setHeader('Content-Type', image.mime_type || 'application/octet-stream')
  res.setHeader('Content-Length', payload.length)
  res.setHeader('Cache-Control', 'public, max-age=86400')
  if (image.updated_at) {
    res.setHeader('Last-Modified', new Date(image.updated_at).toUTCString())
  }
  return res.send(payload)
}

router.get('/businesses/:id/logo', async (req, res, next) => {
  try {
    const image = await mediaService.getImage(MEDIA_KIND.BUSINESS_LOGO, req.params.id)
    return sendImage(res, image)
  } catch (err) {
    return next(err)
  }
})

router.get('/site/logo', async (_req, res, next) => {
  try {
    const image = await mediaService.getImage(MEDIA_KIND.SITE_LOGO)
    return sendImage(res, image)
  } catch (err) {
    return next(err)
  }
})

export default router
