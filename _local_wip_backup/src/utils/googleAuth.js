import { OAuth2Client } from 'google-auth-library'
import { env } from '../config/env.js'

const client = new OAuth2Client(env.googleClientId)

// Verifies a Google Identity Services ID token (the `credential` the
// frontend's GoogleLogin widget returns) and pulls out the identity fields
// we care about. Throws a client-facing error (picked up by errorHandler)
// on anything from a missing token to a signature/audience mismatch.
export async function verifyGoogleCredential(credential) {
  if (typeof credential !== 'string' || !credential.trim()) {
    const err = new Error('Google credential is required')
    err.status = 400
    throw err
  }

  let ticket
  try {
    ticket = await client.verifyIdToken({ idToken: credential, audience: env.googleClientId })
  } catch {
    const err = new Error('Google sign-in could not be verified. Please try again.')
    err.status = 401
    throw err
  }

  const payload = ticket.getPayload()
  if (!payload?.email) {
    const err = new Error('That Google account has no email on file.')
    err.status = 401
    throw err
  }

  return {
    email: payload.email.toLowerCase().trim(),
    name: payload.name ?? '',
    emailVerified: Boolean(payload.email_verified),
  }
}
