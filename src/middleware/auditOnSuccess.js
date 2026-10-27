import { audit } from '../utils/audit.js'

// Records an audit entry once the response has gone out successfully (so a failed payment is never logged as a change).
export const auditOnSuccess = (action, detail = '') => (req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode < 400) audit(req, action, { detail })
  })
  next()
}
