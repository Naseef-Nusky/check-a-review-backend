import dotenv from 'dotenv'

dotenv.config()

export const env = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173,http://localhost:5174,http://localhost:5175',
  BUSINESS_PORTAL_URL: process.env.BUSINESS_PORTAL_URL || 'http://localhost:5175',
  PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL || 'http://localhost:5173',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/check_a_review',
  DATABASE_SSL: process.env.DATABASE_SSL || 'false',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-me',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || 'sendgrid',
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || '',
  SENDGRID_FROM_EMAIL: process.env.SENDGRID_FROM_EMAIL || 'noreply@checkareview.com',
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || '',
  STRIPE_STARTER_PRICE_ID: process.env.STRIPE_STARTER_PRICE_ID || '',
  STRIPE_PREMIUM_PRICE_ID: process.env.STRIPE_PREMIUM_PRICE_ID || '',
  AI_API_KEY: process.env.AI_API_KEY || '',
  AI_API_URL: process.env.AI_API_URL || 'https://api.openai.com/v1',
  AI_AUTO_PUBLISH_THRESHOLD: parseInt(process.env.AI_AUTO_PUBLISH_THRESHOLD || '85', 10),
  ADMIN_EMAIL: process.env.ADMIN_EMAIL || 'superadmin@checkareview.com',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'SuperAdmin@123',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
}
