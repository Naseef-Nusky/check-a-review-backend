import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import routes from './routes/index.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { uploadsRoot } from './middleware/upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicRoot = path.resolve(__dirname, '../public')

const app = express()

// Behind a reverse proxy the original scheme/host arrive as X-Forwarded-* headers,
// which the widget needs to build absolute embed and image URLs.
app.set('trust proxy', true)

// Widgets are meant to be embedded on any customer website, so they opt out of
// the frame-blocking headers Helmet applies to the rest of the API.
app.use('/api/widget', (_req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors *")
  res.removeHeader('X-Frame-Options')
  next()
})

app.use((req, res, next) => {
  if (req.path.startsWith('/api/widget')) return next()
  return helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })(req, res, next)
})
app.use(cors({
  origin: env.CLIENT_URL.split(',').map((url) => url.trim()),
  credentials: true,
}))
app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'))

app.use('/api/subscriptions/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(uploadsRoot))
app.use('/static', express.static(publicRoot))

app.use('/api', routes)

app.use(notFoundHandler)
app.use(errorHandler)

export default app
