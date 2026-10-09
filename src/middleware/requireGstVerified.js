import { requireAuth } from './auth.js'
import { GST_MESSAGES } from '../utils/gstVerification.js'

// Mandatory GST verification gate for the whole employer API
// (/api/employer/*). Default-deny: every route needs a signed-in employer
// whose company's GST verification is VERIFIED, except the short lists
// below — so a route added later is gated without anyone remembering to.
//
//   public      — no sign-in at all (signup/login, pay-first checkout, enquiries)
//   pendingOk   — signed in, GST not yet verified: just enough to see the
//                 company, (re)submit GST verification, get support and
//                 receive notifications.
const PUBLIC = [
  (m, p) => p === '/auth' || p.startsWith('/auth/'),
  (m, p) => m === 'POST' && (p === '/subscription/guest-order' || p === '/subscription/guest-verify'),
  (m, p) => m === 'POST' && p === '/plan-enquiries',
]
const PENDING_OK = [
  (m, p) => m === 'GET' && p === '/company',
  (m, p) => m === 'POST' && p === '/company/verify-gst',
  (m, p) => p === '/support' || p.startsWith('/support/'),
  (m, p) => p === '/notifications' || p.startsWith('/notifications/'),
  (m, p) => p === '/push' || p.startsWith('/push/'),
]

// Express matches routes case-insensitively and ignores a trailing slash,
// so normalise the same way. Anything unrecognised falls to 'verified'
// (the strictest), so a mismatch can only ever over-protect.
export function classifyEmployerPath(method, path) {
  const p = (path.toLowerCase().replace(/\/+$/, '') || '/')
  if (PUBLIC.some((rule) => rule(method, p))) return 'public'
  if (PENDING_OK.some((rule) => rule(method, p))) return 'pendingOk'
  return 'verified'
}

export const isCompanyGstVerified = (company) => company?.gstVerification?.status === 'VERIFIED'

export function requireGstVerified(req, res, next) {
  if (isCompanyGstVerified(req.company)) return next()
  res.status(403).json({
    code: 'GST_VERIFICATION_REQUIRED',
    message: GST_MESSAGES.GST_VERIFICATION_REQUIRED,
    gstStatus: req.company?.gstVerification?.status ?? 'NOT_SUBMITTED',
  })
}

export function employerAccessGate(req, res, next) {
  const access = classifyEmployerPath(req.method, req.path)
  if (access === 'public') return next()
  // requireAuth answers 401 itself; it only calls back once req.user/company are set.
  requireAuth(req, res, (err) => {
    if (err) return next(err)
    if (access === 'pendingOk') return next()
    requireGstVerified(req, res, next)
  })
}
