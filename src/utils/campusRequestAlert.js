import { env } from '../config/env.js'
import { logger } from '../config/logger.js'
import StaffUser from '../models/StaffUser.js'
import { sendMail } from './mailer.js'
import { notifyStaff } from './notifyStaff.js'

// Tells the ops team a college submitted the "Add Your Campus" form, so a
// request doesn't sit in the Operations portal until someone happens to look:
//   - email to CAMPUS_REQUEST_NOTIFY_EMAILS (comma-separated); when that's
//     unset, to every active admin in the staff portal
//   - an in-app notification (+ push) for every active admin
// Best-effort — a failed alert is logged and never fails the submission.

const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export function parseEmailList(value = '') {
  return [...new Set(String(value).split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))]
}

export function buildCampusRequestEmail(request, { opsUrl }) {
  const rows = [
    ['College', request.campusName],
    ['Type', request.institutionType],
    ['Location', [request.city, request.state].filter(Boolean).join(', ')],
    ['Students', request.studentStrength ?? ''],
    ['Website', request.website],
    ['Contact person', request.contactPerson],
    ['Email', request.officialEmail],
    ['Phone', request.phone],
    ['Message', request.message],
  ].filter(([, v]) => v !== '' && v != null)

  const link = `${opsUrl.replace(/\/+$/, '')}/app/campus-requests`
  const subject = `New campus request: ${request.campusName}`
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;color:#111827">
      <p>A college has asked to partner with Mzobs through the “Add Your Campus” form.</p>
      <table cellpadding="6" style="border-collapse:collapse">
        ${rows.map(([k, v]) => `<tr><td style="color:#6b7280;vertical-align:top">${escapeHtml(k)}</td><td>${escapeHtml(v).replace(/\n/g, '<br>')}</td></tr>`).join('')}
      </table>
      <p><a href="${escapeHtml(link)}">Review it in the Operations portal</a></p>
    </div>`
  const text = [
    'A college has asked to partner with Mzobs through the "Add Your Campus" form.',
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `Review it in the Operations portal: ${link}`,
  ].join('\n')
  return { subject, html, text, replyTo: request.officialEmail }
}

export async function alertNewCampusRequest(request, deps = {}) {
  const {
    findAdmins = () => StaffUser.find({ accessLevel: 'admin', status: 'active' }),
    mail = sendMail,
    notify = notifyStaff,
    configuredEmails = env.campusRequestNotifyEmails,
    opsUrl = env.staffFrontendUrl,
    log = logger,
  } = deps

  let admins = []
  try {
    admins = await findAdmins()
  } catch (err) {
    log.error({ err }, 'campus request alert: could not load staff admins')
  }

  const recipients = parseEmailList(configuredEmails)
  const to = recipients.length ? recipients : parseEmailList(admins.map((a) => a.email).join(','))

  const jobs = []
  if (to.length) jobs.push(mail({ to: to.join(', '), ...buildCampusRequestEmail(request, { opsUrl }) }))
  else log.warn('campus request alert: no recipients (set CAMPUS_REQUEST_NOTIFY_EMAILS)')

  const location = [request.city, request.state].filter(Boolean).join(', ')
  for (const admin of admins) {
    jobs.push(notify(admin, {
      category: 'campus-requests',
      title: 'New campus request',
      body: `${request.campusName}${location ? ` (${location})` : ''} wants to partner with Mzobs.`,
    }))
  }

  const results = await Promise.allSettled(jobs)
  for (const r of results) {
    if (r.status === 'rejected') log.error({ err: r.reason }, 'campus request alert failed')
  }
}
