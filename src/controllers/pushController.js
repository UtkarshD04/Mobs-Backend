import { asyncHandler } from '../utils/asyncHandler.js'

// getDoc(req) returns the authenticated recipient doc — req.employee /
// req.user / req.staff — so this same factory serves all three audiences.
export function createPushHandlers(getDoc) {
  const registerExpoToken = asyncHandler(async (req, res) => {
    const { token } = req.body ?? {}
    if (typeof token !== 'string' || !token.trim()) return res.status(400).json({ message: 'token is required' })

    const doc = getDoc(req)
    if (!doc.pushTokens.includes(token)) {
      doc.pushTokens.push(token)
      await doc.save()
    }
    res.status(204).end()
  })

  const subscribeWebPush = asyncHandler(async (req, res) => {
    const { endpoint, keys } = req.body ?? {}
    if (typeof endpoint !== 'string' || !endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: 'endpoint and keys are required' })
    }

    const doc = getDoc(req)
    const exists = doc.webPushSubscriptions.some((s) => s.endpoint === endpoint)
    if (!exists) {
      doc.webPushSubscriptions.push({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } })
      await doc.save()
    }
    res.status(204).end()
  })

  const unsubscribeWebPush = asyncHandler(async (req, res) => {
    const { endpoint } = req.body ?? {}
    if (typeof endpoint !== 'string' || !endpoint) return res.status(400).json({ message: 'endpoint is required' })

    const doc = getDoc(req)
    doc.webPushSubscriptions = doc.webPushSubscriptions.filter((s) => s.endpoint !== endpoint)
    await doc.save()
    res.status(204).end()
  })

  return { registerExpoToken, subscribeWebPush, unsubscribeWebPush }
}
