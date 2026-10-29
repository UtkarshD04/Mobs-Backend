// Login JWTs are stateless and live for up to 90 days, so a password reset
// on its own would leave every already-issued token working. Each account
// records when its password last changed, and the auth middlewares refuse
// any token issued before that moment — "reset your password" then really
// signs out every other device.
//
// `iat` only has one-second precision, so a token issued in the same second
// as the change is still accepted; nothing is lost by that, since the change
// itself never hands out a token.
export function issuedBeforePasswordChange(payload, account) {
  const changedAt = account?.passwordChangedAt
  if (!changedAt || typeof payload?.iat !== 'number') return false
  return payload.iat < Math.floor(new Date(changedAt).getTime() / 1000)
}
