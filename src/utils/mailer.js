import nodemailer from 'nodemailer'
import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

let transporter = null

function getTransporter() {
  if (!env.smtp.host) return null
  if (transporter) return transporter

  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.port === 465,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  })
  return transporter
}

// Falls back to logging the email when SMTP isn't configured, so local dev
// and environments without mail credentials don't crash the reset flow.
export async function sendMail({ to, subject, html, text }) {
  const client = getTransporter()
  if (!client) {
    logger.warn({ to, subject }, 'SMTP not configured — logging email instead of sending')
    logger.info(`\n--- Email (not sent, SMTP unconfigured) ---\nTo: ${to}\nSubject: ${subject}\n${text ?? html}\n---`)
    return
  }

  await client.sendMail({ from: env.smtp.from, to, subject, html, text })
}
