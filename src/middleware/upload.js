import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { fileURLToPath } from 'url'
import { AppError } from '../utils/helpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const uploadsRoot = path.resolve(__dirname, '../../uploads')
export const logosDir = path.join(uploadsRoot, 'logos')
export const avatarsDir = path.join(uploadsRoot, 'avatars')

const LOGO_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
])

const LOGO_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.svg',
  '.ico',
  '.tif',
  '.tiff',
  '.avif',
  '.heic',
  '.heif',
  '.jfif',
  '.pjpeg',
  '.pjp',
])

fs.mkdirSync(logosDir, { recursive: true })
fs.mkdirSync(avatarsDir, { recursive: true })

function createImageUpload({ destination, prefix, errorMessage, allowAnyImage = false }) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, destination)
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase() || '.png'
      const allowed = allowAnyImage ? IMAGE_EXTENSIONS : LOGO_EXTENSIONS
      const safeExt = allowed.has(ext) ? ext : '.png'
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
      cb(null, `${prefix}-${unique}${safeExt}`)
    },
  })

  function fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase()
    const isImageMime = typeof file.mimetype === 'string' && file.mimetype.startsWith('image/')

    if (allowAnyImage) {
      if (!isImageMime && !IMAGE_EXTENSIONS.has(ext)) {
        return cb(new AppError(errorMessage, 400))
      }
      return cb(null, true)
    }

    if (!LOGO_MIME_TYPES.has(file.mimetype) || !LOGO_EXTENSIONS.has(ext)) {
      return cb(new AppError(errorMessage, 400))
    }
    cb(null, true)
  }

  return multer({
    storage,
    fileFilter,
    limits: {
      fileSize: 5 * 1024 * 1024,
    },
  })
}

export const logoUpload = createImageUpload({
  destination: logosDir,
  prefix: 'logo',
  errorMessage: 'Invalid logo format. Use PNG, JPG, or WEBP (max 2MB, square recommended).',
})

/** Memory storage — used when persisting logos in PostgreSQL instead of disk. */
export const logoUploadMemory = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (!LOGO_MIME_TYPES.has(file.mimetype) || !LOGO_EXTENSIONS.has(ext)) {
      return cb(
        new AppError('Invalid logo format. Use PNG, JPG, or WEBP (max 2MB, square recommended).', 400),
      )
    }
    cb(null, true)
  },
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
})

export const avatarUpload = createImageUpload({
  destination: avatarsDir,
  prefix: 'avatar',
  allowAnyImage: true,
  errorMessage: 'Please upload an image file for your profile picture (max 5MB).',
})

export function buildLogoPublicPath(filename) {
  return `/uploads/logos/${filename}`
}

export function buildAvatarPublicPath(filename) {
  return `/uploads/avatars/${filename}`
}
