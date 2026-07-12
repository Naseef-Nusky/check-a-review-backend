import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import { env } from './config/env.js'
import routes from './routes/index.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'

const app = express()

app.use(helmet())
app.use(cors({
  origin: env.CLIENT_URL.split(',').map((url) => url.trim()),
  credentials: true,
}))
app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'))

app.use('/api/subscriptions/webhook', express.raw({ type: 'application/json' }))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

app.use('/api', routes)

app.use(notFoundHandler)
app.use(errorHandler)

export default app
