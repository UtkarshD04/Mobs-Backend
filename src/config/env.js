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
  // Scaling knobs — every default keeps the old single-process behaviour.
  // WEB_CONCURRENCY: node-cluster workers per container (number, or "auto" = one per CPU).
  // Leave unset under PM2 cluster mode (ecosystem.config.cjs), which forks its own workers.
  webConcurrency: process.env.WEB_CONCURRENCY ?? '',
  // Total Mongo connections ≈ workers/replicas * this — keep it under the Atlas tier's limit.
  mongoMaxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE ?? 10) || 10,
  mongoMinPoolSize: Number(process.env.MONGO_MIN_POOL_SIZE ?? 0) || 0,
  // Keep-alive must outlive the reverse proxy's idle timeout, or the proxy reuses a socket
  // we just closed and the client sees a random 502.
  keepAliveTimeoutMs: Number(process.env.KEEP_ALIVE_TIMEOUT_MS ?? 65000) || 65000,
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 120000) || 120000,
  // How long a draining instance waits for in-flight requests before closing them.
  shutdownGraceMs: Number(process.env.SHUTDOWN_GRACE_MS ?? 10000) || 10000,
  // Load shedding: above this event-loop delay (ms, p99) the instance answers 503 + Retry-After
  // so the load balancer retries elsewhere. 0 = off.
  maxEventLoopLagMs: Number(process.env.MAX_EVENT_LOOP_LAG_MS ?? 0) || 0,
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '12h',
  // Job-seeker and employer (mobile app) sessions stay signed in for months; staff keep the short one.
  employeeJwtExpiresIn: process.env.EMPLOYEE_JWT_EXPIRES_IN ?? '90d',
  employerJwtExpiresIn: process.env.EMPLOYER_JWT_EXPIRES_IN ?? '90d',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5176,http://localhost:5177,http://localhost:5178')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  // When true, rejecting a candidate without structured feedback is refused by the API. Left off by default so
  // older app builds that only send a free-text reason keep working until they are updated.
  rejectionFeedbackRequired: process.env.REJECTION_FEEDBACK_REQUIRED === 'true',
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
  // Who gets emailed when a college submits the "Add Your Campus" form
  // (comma-separated). Unset → every active admin in the staff portal.
  campusRequestNotifyEmails: process.env.CAMPUS_REQUEST_NOTIFY_EMAILS ?? '',
  smtp: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'Mzobs <no-reply@mzobs.com>',
    // A real, monitored inbox here (rather than no-reply@) is one of the
    // signals mailbox providers use to judge whether mail is legitimate.
    replyTo: process.env.MAIL_REPLY_TO ?? '',
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
  // Bundle ID of the iOS app — the `aud` of a "Sign in with Apple" identity token.
  appleClientId: process.env.APPLE_CLIENT_ID ?? 'com.mzobs.app',
  // Bundle ID of the employer iOS app — the `bundleId` of its signed in-app purchase transactions.
  appleEmployerBundleId: process.env.APPLE_EMPLOYER_BUNDLE_ID ?? 'com.mzobs.employer',
  // Oldest Android versionCode allowed to run the mobile app; older builds get a blocking
  // "Update required" screen. 0 = off. Raise it (in Dokploy env) to force an update.
  minAndroidVersionCode: Number(process.env.MIN_ANDROID_VERSION_CODE ?? 0) || 0,
  // App-store review login (see utils/reviewLogin.js). Both blank = off, which is the normal state.
  reviewLogin: {
    phone: process.env.REVIEW_LOGIN_PHONE ?? '',
    otp: process.env.REVIEW_LOGIN_OTP ?? '',
    // The review account is created with Premium unless this is "false". Set it to false for
    // App Store review so the reviewer sees (and can test) the Premium purchase button.
    premium: process.env.REVIEW_LOGIN_PREMIUM !== 'false',
  },
  // Employer-app store review login: this one number skips MSG91 and accepts this fixed code on
  // the employer side only. Both blank = off. Pick an OTP that isn't guessable.
  employerReviewLogin: {
    phone: process.env.EMPLOYER_REVIEW_LOGIN_PHONE ?? '',
    otp: process.env.EMPLOYER_REVIEW_LOGIN_OTP ?? '',
  },
  // MSG91 OTP API — https://control.msg91.com. Left blank, mobile OTP
  // verification fails cleanly with a 503 instead of crashing (same
  // no-op pattern as SMTP/VAPID/Razorpay/Google above). templateId is the
  // DLT-registered OTP template id from the MSG91 dashboard.
  msg91: {
    authKey: process.env.MSG91_AUTH_KEY ?? '',
    templateId: process.env.MSG91_OTP_TEMPLATE_ID ?? '',
    // DLT-registered *outreach* SMS template (a recruiter texting a candidate
    // from the portal). It must use exactly two variables, ##name## and
    // ##company## — see utils/outreach.js for the wording to register. Blank =
    // portal SMS reports "not set up" instead of sending.
    smsTemplateId: process.env.MSG91_SMS_TEMPLATE_ID ?? '',
    // DLT-registered *OTP* SMS template sent through the SMS (Flow) API. When set, mobile OTPs are
    // generated and checked by us and MSG91 only delivers the text, instead of using MSG91's OTP
    // API above. The template needs one variable, named by otpFlowVariable (default ##otp##).
    // Blank = the OTP API (MSG91_OTP_TEMPLATE_ID) is used, as before.
    otpFlowTemplateId: process.env.MSG91_OTP_FLOW_TEMPLATE_ID ?? '',
    otpFlowVariable: process.env.MSG91_OTP_FLOW_VARIABLE || 'otp',
    // Optional second variable for templates that also say how long the code lasts ("Valid for ##x##
    // minutes"). Filled with the code's lifetime in minutes. Blank = not sent.
    otpFlowValidityVariable: process.env.MSG91_OTP_FLOW_VALIDITY_VARIABLE ?? '',
  },
  // Groq API (free tier) for AI candidate search. Blank key = /ai endpoints return 503 and the
  // frontend falls back to its local parser.
  groq: {
    apiKey: process.env.GROQ_API_KEY ?? '',
    model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-20b',
  },
  // Employer GSTIN verification through a licensed GST API vendor (see
  // utils/gstProviders.js). Server-side only — never sent to any client.
  // Blank provider/credentials = verification answers 503 GST_NOT_CONFIGURED
  // and no company is ever marked verified (same no-op pattern as AWS below).
  // GSTINAPI_API_KEY / GSTINAPI_BASE_URL (gstinapi.in) are accepted as-is and
  // select that adapter when no GST_VERIFICATION_PROVIDER is set.
  gstVerification: {
    provider: process.env.GST_VERIFICATION_PROVIDER || (process.env.GSTINAPI_API_KEY ? 'gstinapi' : ''),
    apiKey: process.env.GST_VERIFICATION_API_KEY || process.env.GSTINAPI_API_KEY || '',
    apiSecret: process.env.GST_VERIFICATION_API_SECRET ?? '',
    baseUrl: process.env.GST_VERIFICATION_BASE_URL || process.env.GSTINAPI_BASE_URL || '',
    timeoutMs: Number(process.env.GST_VERIFICATION_TIMEOUT_MS ?? 10000) || 10000,
    // GST_VERIFICATION_REQUIRED=true makes a verified GSTIN mandatory: signup
    // refuses a missing GSTIN and the employer API stays locked until the
    // company is VERIFIED. Off by default — GSTIN is then optional at signup
    // (still checked when given) and nothing is gated on it.
    required: process.env.GST_VERIFICATION_REQUIRED === 'true',
  },
  // Geocoding proxy for the employer dashboard's location filters (utils/geocoder.js). Nominatim-
  // compatible; the key (if any) stays server-side. GEOCODER_ENABLED=false answers 503.
  geocoder: {
    enabled: process.env.GEOCODER_ENABLED !== 'false',
    baseUrl: (process.env.GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org').replace(/\/$/, ''),
    apiKey: process.env.GEOCODER_API_KEY ?? '',
    userAgent: process.env.GEOCODER_USER_AGENT || 'Mzobs-Employer/1.0 (contact: hello@mzobs.com)',
    minGapMs: Number(process.env.GEOCODER_MIN_GAP_MS ?? 1100) || 1100,
    pincodeApiUrl: (process.env.PINCODE_API_URL || 'https://api.postalpincode.in/pincode').replace(/\/$/, ''),
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
        planCode: process.env.EMPLOYER_PLAN_BASIC_CODE ?? 'EMPLOYER_ANNUAL_1499',
        planName: process.env.EMPLOYER_PLAN_BASIC_NAME ?? 'MZOBS Employer Annual',
        // Base price before tax, in paise. Default 149900 paise = ₹1499.
        amountPaise: Number(process.env.EMPLOYER_PLAN_BASIC_AMOUNT_PAISE ?? process.env.EMPLOYER_ANNUAL_PLAN_AMOUNT_PAISE ?? 149900),
        // CV credits added to the company's wallet once, when the plan activates.
        cvCredits: Number(process.env.EMPLOYER_PLAN_BASIC_CV_CREDITS ?? 40),
        benefits: [],
      },
      {
        planCode: process.env.EMPLOYER_PLAN_PLUS_CODE ?? 'EMPLOYER_ANNUAL_1999',
        planName: process.env.EMPLOYER_PLAN_PLUS_NAME ?? 'MZOBS Employer Annual Plus',
        // Default 199900 paise = ₹1999.
        amountPaise: Number(process.env.EMPLOYER_PLAN_PLUS_AMOUNT_PAISE ?? 199900),
        cvCredits: Number(process.env.EMPLOYER_PLAN_PLUS_CV_CREDITS ?? 20),
        benefits: ['Enhanced candidate CVs'],
      },
      {
        planCode: process.env.EMPLOYER_PLAN_PRO_CODE ?? 'EMPLOYER_ANNUAL_2999',
        planName: process.env.EMPLOYER_PLAN_PRO_NAME ?? 'MZOBS Employer Annual Pro',
        // Default 299900 paise = ₹2999.
        amountPaise: Number(process.env.EMPLOYER_PLAN_PRO_AMOUNT_PAISE ?? 299900),
        cvCredits: Number(process.env.EMPLOYER_PLAN_PRO_CV_CREDITS ?? 40),
        benefits: ['Enhanced candidate CVs'],
      },
    ],
  },
}

// A guessable signing secret lets anyone forge staff/employer/employee tokens. Warn (don't
// refuse to boot, so a live deploy can't be taken down by this check) when production runs
// with a short or dev-looking JWT_SECRET.
if (env.isProduction && (env.jwtSecret.length < 32 || /^dev[-_]|changeme|secret$/i.test(env.jwtSecret))) {
  console.warn('[security] JWT_SECRET is weak for production — set a random value of 32+ characters (e.g. `openssl rand -hex 48`) in Dokploy.')
}
