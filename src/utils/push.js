import webpush from 'web-push'
import { Expo } from 'expo-server-sdk'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

const expo = new Expo()

let vapidConfigured = false
if (env.vapid.publicKey && env.vapid.privateKey) {
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey)
  vapidConfigured = true
}

async function sendExpoPush(recipient, payload) {
  const validTokens = recipient.pushTokens.filter((t) => Expo.isExpoPushToken(t))
  if (!validTokens.length) return

  const messages = validTokens.map((token) => ({ to: token, title: payload.title, body: payload.body, data: payload.data ?? {} }))
  const chunks = expo.chunkPushNotifications(messages)
  const deadTokens = new Set()

  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk)
      tickets.forEach((ticket, i) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          deadTokens.add(chunk[i].to)
        }
      })
    } catch (err) {
      logger.warn({ err }, 'Expo push chunk failed')
    }
  }

  if (deadTokens.size) {
    recipient.pushTokens = recipient.pushTokens.filter((t) => !deadTokens.has(t))
  }
}

async function sendWebPush(recipient, payload) {
  if (!vapidConfigured || !recipient.webPushSubscriptions.length) return

  const body = JSON.stringify({ title: payload.title, body: payload.body, data: payload.data ?? {} })
  const deadEndpoints = new Set()

  await Promise.all(
    recipient.webPushSubscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body)
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) deadEndpoints.add(sub.endpoint)
        else logger.warn({ err }, 'Web push send failed')
      }
    })
  )

  if (deadEndpoints.size) {
    recipient.webPushSubscriptions = recipient.webPushSubscriptions.filter((s) => !deadEndpoints.has(s.endpoint))
  }
}

// recipient is a mongoose doc (Employee/User/StaffUser) with pushTokens +
// webPushSubscriptions arrays. Silently no-ops per channel if that channel
// isn't configured, same graceful-degrade pattern as utils/mailer.js.
export async function sendPush(recipient, payload) {
  if (!recipient.pushTokens?.length && !recipient.webPushSubscriptions?.length) return

  await Promise.all([sendExpoPush(recipient, payload), sendWebPush(recipient, payload)])
  await recipient.save()
}
