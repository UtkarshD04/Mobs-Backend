const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required('MONGO_URI'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  seedAdminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@solacetech.dev',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? 'Passw0rd!123',
  seedCompanyName: process.env.SEED_COMPANY_NAME ?? 'Solace Technologies',
  seedStaffName: process.env.SEED_STAFF_NAME ?? 'Mzobs Ops Admin',
  seedStaffEmail: process.env.SEED_STAFF_EMAIL ?? 'ops@mzobs.dev',
  seedStaffPassword: process.env.SEED_STAFF_PASSWORD ?? 'Passw0rd!123',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? '',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  // Base URL of the marketing site — used to build the link inside
  // password-reset emails (e.g. `${frontendUrl}/employees/reset-password?token=...`).
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5176',
  // Base URL of the internal staff portal (Company-Frontend) — used to build
  // the link inside staff password-reset emails.
  staffFrontendUrl: process.env.STAFF_FRONTEND_URL ?? 'http://localhost:5174',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'Mzobs <no-reply@mzobs.com>',
  },
}
