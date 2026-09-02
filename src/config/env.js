import dotenv from 'dotenv'

dotenv.config()

export const env = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176',
  BUSINESS_PORTAL_URL: process.env.BUSINESS_PORTAL_URL || 'http://localhost:5175',
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL || 'http://localhost:5173',
  PUBLIC_API_URL: process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 5000}`,
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/check_a_review',
  DATABASE_SSL: process.env.DATABASE_SSL || 'false',
  JWT_SECRET:
    process.env.JWT_SECRET || (process.env.NODE_ENV === 'production' ? '' : 'dev-secret-change-me'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  ADMIN_PORTAL_URL: process.env.ADMIN_PORTAL_URL || 'http://localhost:5174',
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || '',
  SENDGRID_FROM_EMAIL: process.env.SENDGRID_FROM_EMAIL || 'noreply@checkareview.com',
  // Square billing (sandbox by default)
  SQUARE_ENVIRONMENT: process.env.SQUARE_ENVIRONMENT || 'sandbox',
  SQUARE_ACCESS_TOKEN: process.env.SQUARE_ACCESS_TOKEN || '',
  SQUARE_APPLICATION_ID: process.env.SQUARE_APPLICATION_ID || '',
  SQUARE_LOCATION_ID: process.env.SQUARE_LOCATION_ID || '',
  SQUARE_WEBHOOK_SIGNATURE_KEY: process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '',
  SQUARE_WEBHOOK_NOTIFICATION_URL:
    process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ||
    `http://localhost:${process.env.PORT || 5001}/api/subscriptions/webhook`,
  SQUARE_STARTER_PLAN_ID: process.env.SQUARE_STARTER_PLAN_ID || '',
  SQUARE_PLUS_PLAN_ID: process.env.SQUARE_PLUS_PLAN_ID || '',
  SQUARE_PREMIUM_PLAN_ID: process.env.SQUARE_PREMIUM_PLAN_ID || '',
  SQUARE_STARTER_AMOUNT_CENTS: process.env.SQUARE_STARTER_AMOUNT_CENTS || '9900',
  SQUARE_PLUS_AMOUNT_CENTS: process.env.SQUARE_PLUS_AMOUNT_CENTS || '31900',
  SQUARE_PREMIUM_AMOUNT_CENTS: process.env.SQUARE_PREMIUM_AMOUNT_CENTS || '79900',
  SQUARE_CURRENCY: process.env.SQUARE_CURRENCY || 'GBP',
  SALES_EMAIL: process.env.SALES_EMAIL || process.env.SENDGRID_FROM_EMAIL || 'info@checkareview.com',
  AI_PROVIDER: process.env.AI_PROVIDER || 'gemini',
  AI_API_KEY: process.env.AI_API_KEY || '',
  AI_MODEL: process.env.AI_MODEL || 'gemini-3.5-flash-lite',
  AI_API_URL: process.env.AI_API_URL || 'https://api.openai.com/v1',
  AI_AUTO_PUBLISH_THRESHOLD: parseInt(process.env.AI_AUTO_PUBLISH_THRESHOLD || '85', 10),
  ADMIN_EMAIL:
    process.env.ADMIN_EMAIL || (process.env.NODE_ENV === 'production' ? '' : 'superadmin@checkareview.com'),
  ADMIN_PASSWORD:
    process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'SuperAdmin@123'),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
}

export function assertProductionSecrets() {
  if (String(process.env.NODE_ENV || 'development') !== 'production') return
  const secret = String(process.env.JWT_SECRET || '')
  const weak =
    secret.length < 32 ||
    /dev-secret|change-me|change-in-production|your-super-secret/i.test(secret)
  if (weak) {
    throw new Error('JWT_SECRET must be a strong random value in production (at least 32 characters).')
  }

  const adminEmail = String(process.env.ADMIN_EMAIL || '')
  const adminPassword = String(process.env.ADMIN_PASSWORD || '')
  const defaultEmail = 'superadmin@checkareview.com'
  const defaultPassword = 'SuperAdmin@123'
  if (!adminEmail || adminEmail === defaultEmail) {
    throw new Error('ADMIN_EMAIL must be set to a real, non-default value in production.')
  }
  if (!adminPassword || adminPassword === defaultPassword) {
    throw new Error('ADMIN_PASSWORD must be set to a strong, non-default value in production.')
  }
}
