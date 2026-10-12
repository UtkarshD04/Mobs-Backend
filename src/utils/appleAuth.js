import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

const APPLE_ISSUER = 'https://appleid.apple.com'
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys'
const KEYS_TTL_MS = 60 * 60 * 1000

let cachedKeys = null
let cachedAt = 0

function fail(message, status) {
  const err = new Error(message)
  err.status = status
  return err
}

async function getAppleKey(kid) {
  const stale = !cachedKeys || Date.now() - cachedAt > KEYS_TTL_MS
  if (stale || !cachedKeys.has(kid)) {
    const res = await fetch(APPLE_KEYS_URL)
    if (!res.ok) throw fail('Could not reach Apple to verify sign-in', 503)
    const { keys } = await res.json()
    cachedKeys = new Map(keys.map((k) => [k.kid, crypto.createPublicKey({ key: k, format: 'jwk' })]))
    cachedAt = Date.now()
  }
  return cachedKeys.get(kid) ?? null
}

// Verifies a "Sign in with Apple" identity token (JWT) from the iOS app against Apple's public
// keys. The audience is the app's bundle ID. Throws a status-tagged error on any failure, which
// asyncHandler routes to errorHandler. Returns the same shape idea as verifyGoogleToken:
// { appleId, email }. Apple sends the user's name only to the app (first sign-in), never in the
// token, so the signup route takes it from the request body.
export async function verifyAppleToken(identityToken) {
  if (typeof identityToken !== 'string' || !identityToken) throw fail('Apple credential is required', 400)

  const decoded = jwt.decode(identityToken, { complete: true })
  if (!decoded?.header?.kid) throw fail('Invalid Apple credential', 401)

  const key = await getAppleKey(decoded.header.kid)
  if (!key) throw fail('Invalid Apple credential', 401)

  let payload
  try {
    payload = jwt.verify(identityToken, key, { algorithms: ['RS256'], issuer: APPLE_ISSUER, audience: env.appleClientId })
  } catch {
    throw fail('Invalid or expired Apple credential', 401)
  }

  if (!payload.email) throw fail('This Apple account shared no email address', 400)
  if (payload.email_verified === false || payload.email_verified === 'false') {
    throw fail('This Apple account\'s email address is not verified', 400)
  }

  return { appleId: payload.sub, email: payload.email.toLowerCase().trim() }
}
