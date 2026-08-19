import crypto from 'crypto'

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000 // 30 minutes

// The raw token goes out in the email link; only its hash is stored, so a
// leaked/compromised DB never exposes usable reset tokens.
export function createResetToken() {
  const token = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS)
  return { token, tokenHash, expires }
}

export function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function resetPasswordEmailHtml({ name, resetUrl }) {
  return `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#0B1220;">Reset your Mzobs password</h2>
      <p>Hi ${name || 'there'},</p>
      <p>We received a request to reset your password. This link expires in 30 minutes.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#333333;color:#fff;border-radius:999px;text-decoration:none;">Reset password</a></p>
      <p>If you didn't request this, you can safely ignore this email — your password won't change.</p>
    </div>
  `
}
