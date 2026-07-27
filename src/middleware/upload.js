import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { fileURLToPath } from 'url'
import { AppError } from '../utils/helpers.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const uploadsRoot = path.resolve(__dirname, '../../uploads')
export const logosDir = path.join(uploadsRoot, 'logos')

const ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
])

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

fs.mkdirSync(logosDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, logosDir)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png'
    const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.png'
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`
    cb(null, `logo-${unique}${safeExt}`)
  },
})

function fileFilter(_req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase()
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
    return cb(
      new AppError('Invalid logo format. Use PNG, JPG, or WEBP (max 2MB, square recommended).', 400),
    )
  }
  cb(null, true)
}

export const logoUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
})

export function buildLogoPublicPath(filename) {
  return `/uploads/logos/${filename}`
}
