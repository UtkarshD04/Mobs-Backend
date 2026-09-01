import { OAuth2Client } from 'google-auth-library'
import { env } from '../config/env.js'

let client = null

export function isGoogleAuthConfigured() {
  return Boolean(env.googleClientId)
}

function getClient() {
  if (!client) client = new OAuth2Client(env.googleClientId)
  return client
}

// Verifies a Google Identity Services credential (ID token) server-side —
// never trust the name/email a client claims to have decoded from it
// themselves. Throws a status-tagged error on any failure, which asyncHandler
// routes to errorHandler.
export async function verifyGoogleToken(credential) {
  if (!env.googleClientId) {
    const err = new Error('Google sign-in is not configured on this server')
    err.status = 503
    throw err
  }
  if (typeof credential !== 'string' || !credential) {
    const err = new Error('Google credential is required')
    err.status = 400
    throw err
  }

  let ticket
  try {
    ticket = await getClient().verifyIdToken({ idToken: credential, audience: env.googleClientId })
  } catch {
    const err = new Error('Invalid or expired Google credential')
    err.status = 401
    throw err
  }

  const payload = ticket.getPayload()
  if (!payload?.email) {
    const err = new Error('This Google account has no email on file')
    err.status = 400
    throw err
  }

  return { googleId: payload.sub, email: payload.email.toLowerCase().trim(), name: payload.name ?? '' }
}
