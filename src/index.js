import app from './app.js'
import { env, assertProductionSecrets } from './config/env.js'
import { pool } from './db/pool.js'

async function start() {
  try {
    assertProductionSecrets()
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

  const SIX_HOURS = 6 * 60 * 60 * 1000
  const runRenewalReminders = async () => {
    try {
      const { subscriptionService } = await import('./services/subscription.service.js')
      const sent = await subscriptionService.processRenewalReminders()
      if (sent) console.log(`Sent ${sent} monthly renewal reminder email(s)`)
    } catch (err) {
      console.error('Renewal reminder job failed:', err.message)
    }
  }
  setTimeout(runRenewalReminders, 15_000)
  setInterval(runRenewalReminders, SIX_HOURS)
}

start()
