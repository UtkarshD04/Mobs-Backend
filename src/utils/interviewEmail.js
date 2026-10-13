import { revealedParts } from './candidateReveal.js'
import { sendMail, isMailConfigured } from './mailer.js'
import { logger } from '../config/logger.js'

// The email an employer can send a candidate when scheduling, rescheduling or cancelling an
// interview. Sent from Mzobs's own address with replies going to the recruiter, like outreach.
//
// Who may be emailed: someone who applied to this company (an interview invitation is the
// expected next step), or anyone whose email the company has already paid to reveal. A profile
// the company only found in the database and never unlocked is not emailed from here.

export const INTERVIEW_EMAIL_KINDS = ['scheduled', 'rescheduled', 'cancelled']

const escapeHtml = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
// eslint-disable-next-line no-control-regex
const clean = (t) => String(t ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
const firstName = (name) => clean(name).split(/\s+/)[0] || 'there'

// A meeting link goes into an email as a clickable link, so only http(s) is ever allowed.
export function safeLink(link) {
  const value = clean(link)
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

const IST = 'Asia/Kolkata'
export function formatWhen(startsAt, durationMins) {
  const start = new Date(startsAt)
  const date = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: IST }).format(start)
  const time = (d) => new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST }).format(d).replace(/\s/g, ' ').toLowerCase()
  const end = durationMins ? new Date(start.getTime() + durationMins * 60000) : null
  return { date, time: end ? `${time(start)} – ${time(end)}` : time(start), zone: 'IST' }
}

export function maskEmail(email) {
  const [user, domain] = String(email ?? '').split('@')
  return user && domain ? `${user.slice(0, 1)}${'*'.repeat(Math.max(user.length - 1, 3))}@${domain}` : null
}

export function interviewEmailGate({ candidate, unlock }) {
  return Boolean(candidate?.application) || revealedParts(unlock).has('email')
}

const HEADLINE = {
  scheduled: (c) => `You're invited to interview with ${c}`,
  rescheduled: (c) => `Your interview with ${c} has a new time`,
  cancelled: (c) => `Your interview with ${c} has been cancelled`,
}
const INTRO = {
  scheduled: (c, role) => `${c} would like to interview you for the ${role} role. Here are the details.`,
  rescheduled: (c, role) => `${c} has moved your interview for the ${role} role. Please note the new time below.`,
  cancelled: (c, role) => `${c} has cancelled your interview for the ${role} role. We're sorry for any inconvenience.`,
}

export function buildInterviewEmail(kind, { candidateName, companyName, role, round, startsAt, durationMins, mode, meetingLink, location, panel = [], recruiterName, recruiterEmail }) {
  const company = clean(companyName) || 'The employer'
  const roleName = clean(role) || 'the open'
  const when = formatWhen(startsAt, durationMins)
  const link = safeLink(meetingLink)
  const where = mode === 'On-site' ? clean(location) || 'On-site (the recruiter will share the address)' : link ? 'Video call' : 'Video call (link to follow)'
  const people = (panel ?? []).map(clean).filter(Boolean)

  const rows = [
    ['Role', roleName + (clean(round) ? ` · ${clean(round)}` : '')],
    ['Date', when.date],
    ['Time', `${when.time} ${when.zone}`],
    [mode === 'On-site' ? 'Location' : 'Mode', where],
    ...(people.length ? [['Interviewers', people.join(', ')]] : []),
  ]
  const subject = kind === 'cancelled' ? `Interview cancelled: ${roleName} at ${company}` : kind === 'rescheduled' ? `New interview time: ${roleName} at ${company}` : `Interview invitation: ${roleName} at ${company}`
  const strike = kind === 'cancelled'
  const footer = `Sent by ${clean(recruiterName) || 'the recruiter'} (${company}) through Mzobs. Reply to this email to reach ${clean(recruiterEmail) || 'them'} directly.`

  const tableRows = rows
    .map(([k, v]) => `<tr><td style="padding:8px 16px 8px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top">${escapeHtml(k)}</td><td style="padding:8px 0;font-size:15px;color:#16324f;font-weight:600${strike ? ';text-decoration:line-through' : ''}">${escapeHtml(v)}</td></tr>`)
    .join('')
  const button = link && kind !== 'cancelled' ? `<p style="margin:24px 0 0"><a href="${escapeHtml(link)}" style="background:#0b7a6d;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:8px;display:inline-block">Join the interview</a></p>` : ''
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#16324f">` +
    `<h2 style="font-size:20px;margin:0 0 8px">${escapeHtml(HEADLINE[kind](company))}</h2>` +
    `<p style="font-size:15px;line-height:1.6;margin:0 0 16px">Hi ${escapeHtml(firstName(candidateName))}, ${escapeHtml(INTRO[kind](company, roleName))}</p>` +
    `<table role="presentation" style="border-top:1px solid #e6eaf0;border-bottom:1px solid #e6eaf0;width:100%;border-collapse:collapse">${tableRows}</table>` +
    button +
    `<p style="font-size:12px;color:#64748b;margin:28px 0 0">${escapeHtml(footer)}</p></div>`

  const text = [
    `Hi ${firstName(candidateName)}, ${INTRO[kind](company, roleName)}`,
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(link && kind !== 'cancelled' ? ['', `Join: ${link}`] : []),
    '',
    footer,
  ].join('\n')
  return { subject, html, text }
}

const DEFAULT_DEPS = { sendMail, isMailConfigured }

// Sends the email and answers with a status the app can show — never throws, so a mail problem
// can't undo the interview that was just saved. Statuses: sent | failed | not_configured |
// no_email | not_allowed.
export async function sendInterviewEmail({ kind, interview, candidate, employee, unlock, company, user, deps = DEFAULT_DEPS }) {
  if (!INTERVIEW_EMAIL_KINDS.includes(kind)) return { status: 'failed', error: 'Unknown email type' }
  if (!interviewEmailGate({ candidate, unlock })) return { status: 'not_allowed' }
  const to = employee?.email || candidate?.email
  if (!to) return { status: 'no_email' }
  if (!deps.isMailConfigured()) return { status: 'not_configured' }

  const mail = buildInterviewEmail(kind, {
    candidateName: candidate?.name ?? interview.candidateName,
    companyName: company?.name,
    role: interview.role,
    round: interview.round,
    startsAt: interview.startsAt,
    durationMins: interview.durationMins,
    mode: interview.mode,
    meetingLink: interview.meetingLink,
    location: interview.location,
    panel: interview.panel,
    recruiterName: user?.name,
    recruiterEmail: user?.email,
  })
  try {
    await deps.sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text, replyTo: user?.email })
    return { status: 'sent', to: maskEmail(to), sentAt: new Date().toISOString() }
  } catch (err) {
    logger.warn({ err }, 'Interview email failed')
    return { status: 'failed', to: maskEmail(to), error: String(err?.message ?? err).slice(0, 200) }
  }
}
