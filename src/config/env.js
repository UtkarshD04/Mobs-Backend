const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required('MONGO_URI'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://localhost:5177,http://localhost:5178')
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
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY ?? '',
    privateKey: process.env.VAPID_PRIVATE_KEY ?? '',
    subject: process.env.VAPID_SUBJECT ?? 'mailto:hello@mzobs.com',
  },
  // Left blank, rate limiting falls back to an in-memory store (fine for a
  // single instance). Set this once the backend runs as more than one PM2
  // cluster worker / server instance, so limits are shared instead of
  // multiplied per-process.
  redisUrl: process.env.REDIS_URL ?? '',
  // OAuth Web Client ID from Google Cloud Console — must match the one the
  // frontend's GoogleOAuthProvider uses, since the backend checks it as the
  // token's `aud` claim. Left blank, "Continue with Google" fails cleanly
  // with a 503 instead of crashing (same no-op pattern as SMTP/VAPID/Razorpay).
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  // App-store review login (see utils/reviewLogin.js). Both blank = off, which is the normal state.
  reviewLogin: {
    phone: process.env.REVIEW_LOGIN_PHONE ?? '',
    otp: process.env.REVIEW_LOGIN_OTP ?? '',
  },
  // MSG91 OTP API — https://control.msg91.com. Left blank, mobile OTP
  // verification fails cleanly with a 503 instead of crashing (same
  // no-op pattern as SMTP/VAPID/Razorpay/Google above). templateId is the
  // DLT-registered OTP template id from the MSG91 dashboard.
  msg91: {
    authKey: process.env.MSG91_AUTH_KEY ?? '',
    templateId: process.env.MSG91_OTP_TEMPLATE_ID ?? '',
  },
  // AWS S3 for private candidate file storage (resumes). Region defaults to
  // Mumbai since that's where the bucket lives. Left blank, upload/download
  // endpoints fail cleanly with a 503 instead of crashing (same no-op
  // pattern as SMTP/VAPID/Razorpay/Google above) — lets the app boot and
  // serve everything else even before AWS credentials are provisioned.
  aws: {
    region: process.env.AWS_REGION ?? 'ap-south-1',
    bucket: process.env.AWS_S3_BUCKET ?? '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
  },
  // GST on the subscription fee — the fee is treated as tax-inclusive, so
  // the taxable value is derived by carving GST out of it rather than added
  // on top; the candidate's checkout price doesn't change. Left blank, the
  // invoice PDF prints without any tax breakdown (pre-GST-registration state).
  gst: {
    number: process.env.GST_NUMBER ?? '',
    ratePercent: Number(process.env.GST_RATE_PERCENT ?? 18),
    // Used only to label the split as CGST+SGST — we don't collect the
    // candidate's billing state, so this assumes intra-state (same state as
    // the company) for every invoice. Get this confirmed by your CA before
    // relying on it for interstate transactions (which should be IGST).
    state: process.env.GST_STATE ?? 'Uttar Pradesh',
  },
  // The employer's annual plan tiers. Unlike `gst` above (which treats the
  // employee subscription fee as tax-inclusive), GST_MODE=exclusive means
  // each amount below is the pre-tax base price — GST is computed and added
  // on top at checkout, and the final payable amount is what actually gets
  // charged via Razorpay. Never guess this at the UI layer; everything reads
  // it from here. gstMode/gstRatePercent are shared across every tier.
  employerPlan: {
    billingPeriod: 'annual',
    gstMode: process.env.EMPLOYER_ANNUAL_PLAN_GST_MODE ?? 'exclusive', // 'inclusive' | 'exclusive'
    gstRatePercent: Number(process.env.EMPLOYER_ANNUAL_PLAN_GST_RATE ?? process.env.GST_RATE_PERCENT ?? 18),
    plans: [
      {
        planCode: process.env.EMPLOYER_PLAN_BASIC_CODE ?? 'EMPLOYER_ANNUAL_999',
        planName: process.env.EMPLOYER_PLAN_BASIC_NAME ?? 'MZOBS Employer Annual',
        // Base price before tax, in paise. Default 99900 paise = ₹999.
        amountPaise: Number(process.env.EMPLOYER_PLAN_BASIC_AMOUNT_PAISE ?? process.env.EMPLOYER_ANNUAL_PLAN_AMOUNT_PAISE ?? 99900),
        benefits: [],
      },
      {
        planCode: process.env.EMPLOYER_PLAN_PLUS_CODE ?? 'EMPLOYER_ANNUAL_1499',
        planName: process.env.EMPLOYER_PLAN_PLUS_NAME ?? 'MZOBS Employer Annual Plus',
        // Default 149900 paise = ₹1499.
        amountPaise: Number(process.env.EMPLOYER_PLAN_PLUS_AMOUNT_PAISE ?? 149900),
        benefits: ['Enhanced candidate CVs'],
      },
      {
        planCode: process.env.EMPLOYER_PLAN_PRO_CODE ?? 'EMPLOYER_ANNUAL_1999',
        planName: process.env.EMPLOYER_PLAN_PRO_NAME ?? 'MZOBS Employer Annual Pro',
        // Default 199900 paise = ₹1999.
        amountPaise: Number(process.env.EMPLOYER_PLAN_PRO_AMOUNT_PAISE ?? 199900),
        benefits: ['Enhanced candidate CVs'],
      },
    ],
  },
}
