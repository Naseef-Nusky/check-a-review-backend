import app from './app.js'
import { env } from './config/env.js'
import { pool } from './db/pool.js'

async function start() {
  try {
    await pool.query('SELECT NOW()')
    console.log('Database connected successfully')
  } catch (err) {
    console.error('Database connection failed:', err.message)
    console.error('Make sure PostgreSQL is running and DATABASE_URL is correct in .env')
    process.exit(1)
  }

  app.listen(env.PORT, () => {
    console.log(`Server running on http://localhost:${env.PORT}`)
    console.log(`API: http://localhost:${env.PORT}/api`)
    console.log(`Environment: ${env.NODE_ENV}`)
  })
}

start()
