import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

// Browser sessions: the web frontends keep the JWT in an httpOnly cookie so
// page script (an XSS) can never read it. Native apps and older builds keep
// sending `Authorization: Bearer` and are untouched.
//
// Marker header the web frontends send on every request. It does two jobs:
// it opts the client into cookie mode (the login response then omits the raw
// token), and — because a custom header forces a CORS preflight that only our
// allow-listed origins pass — it is the CSRF guard for cookie-authenticated
// writes.
export const WEB_CLIENT_HEADER = 'x-requested-with'
export const WEB_CLIENT_VALUE = 'mzobs-web'

// One cookie per audience (the JWTs are all signed with the same secret and
// told apart by their `type` claim), so a staff and an employer login can sit
// side by side in the same browser.
export const AUTH_COOKIES = {
  employer: 'mzobs_employer',
  employee: 'mzobs_employee',
  staff: 'mzobs_staff',
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function audienceOf(url = '') {
  const m = /^\/api\/(employer|employee|staff)(?:\/|\?|$)/.exec(url)
  return m ? m[1] : null
}

export function readCookie(req, name) {
  const header = req.headers.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/',
    ...(maxAgeMs ? { maxAge: maxAgeMs } : {}),
  }
}

export function setAuthCookie(res, audience, token) {
  const exp = jwt.decode(token)?.exp
  const maxAge = exp ? Math.max(exp * 1000 - Date.now(), 0) : undefined
  res.cookie(AUTH_COOKIES[audience], token, cookieOptions(maxAge))
}

export function clearAuthCookie(res, audience) {
  res.clearCookie(AUTH_COOKIES[audience], cookieOptions())
}

export function isWebClient(req) {
  return req.headers[WEB_CLIENT_HEADER] === WEB_CLIENT_VALUE
}

// Mounted ahead of /api. Request side: a cookie session is turned into the
// Authorization header the existing auth middlewares already understand, so
// none of them (or any route) needs to know about cookies. Response side:
// a successful login under /<audience>/auth/ also sets the cookie.
export function authCookies(req, res, next) {
  const audience = audienceOf(req.originalUrl)
  if (!audience) return next()

  if (!req.headers.authorization) {
    const token = readCookie(req, AUTH_COOKIES[audience])
    if (token) {
      if (!SAFE_METHODS.has(req.method) && !isWebClient(req)) {
        return res.status(403).json({ message: 'Blocked: missing client header' })
      }
      req.headers.authorization = `Bearer ${token}`
    }
  }

  // (guest-verify settles a pay-first checkout and returns a normal login token too.)
  if (/^\/api\/[a-z]+\/(auth\/|subscription\/guest-verify)/.test(req.originalUrl)) {
    const json = res.json.bind(res)
    res.json = (body) => {
      if (res.statusCode < 400 && body && typeof body.token === 'string') {
        setAuthCookie(res, audience, body.token)
        if (isWebClient(req)) {
          const { token: _token, ...rest } = body
          return json(rest)
        }
      }
      return json(body)
    }
  }
  next()
}

// POST /api/<audience>/auth/logout
export const logout = (audience) => (_req, res) => {
  clearAuthCookie(res, audience)
  res.json({ ok: true })
}
