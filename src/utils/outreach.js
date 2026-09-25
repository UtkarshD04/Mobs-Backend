import OutreachMessage from '../models/OutreachMessage.js'
import { revealedParts } from './candidateReveal.js'
import { sendMail, isMailConfigured } from './mailer.js'
import { sendSmsFlow, isSmsConfigured } from './msg91.js'

// Recruiter → candidate messages sent from the portal.
//
// Rules: a channel only works once the part it needs has been viewed (which is
// what the CV credit pays for) — email needs the email, SMS needs the phone.
// A recruiter can contact the same candidate at most MAX_PER_CANDIDATE_PER_DAY
// times per channel per day. Email is free text; SMS is a fixed, DLT-registered
// template (India requires pre-approved SMS wording), so it carries no free text.
export const MAX_PER_CANDIDATE_PER_DAY = 3

// The wording to register as the outreach template in MSG91 / DLT, with
// exactly two variables. Its id goes in MSG91_SMS_TEMPLATE_ID.
export const SMS_TEMPLATE_TEXT = 'Hi ##name##, ##company## found your profile on Mzobs and would like to connect. Check your Mzobs account or email. - Mzobs'

const DAY_MS = 24 * 60 * 60 * 1000
const CHANNEL_PART = { email: 'email', sms: 'phone' }
const SUBJECT_MAX = 150
const BODY_MAX = 5000

// eslint-disable-next-line no-control-regex
const stripControl = (t) => String(t ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
const escapeHtml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A 10-digit Indian mobile (starts 6–9) from however it was stored
// ("9876543210", "+91 98765 43210", "09876543210"), or null.
export function normalizeMobile(phone) {
  let digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

export const firstName = (name, max = 20) => stripControl(name).trim().split(/\s+/)[0]?.slice(0, max) || 'there'

// MSG91 / DLT variable fields are short (30 chars by default).
export function smsVariables({ candidateName, companyName }) {
  return { name: firstName(candidateName), company: stripControl(companyName).trim().slice(0, 25) || 'A company' }
}

export const smsText = (vars) => SMS_TEMPLATE_TEXT.replace('##name##', vars.name).replace('##company##', vars.company)

export function validateEmailContent({ subject, body }) {
  const s = stripControl(subject).replace(/[\r\n]+/g, ' ').trim()
  const b = stripControl(body).replace(/\r\n/g, '\n').trim()
  if (!s) return { ok: false, error: 'Add a subject.' }
  if (!b) return { ok: false, error: 'Write a message.' }
  if (s.length > SUBJECT_MAX) return { ok: false, error: `Keep the subject under ${SUBJECT_MAX} characters.` }
  if (b.length > BODY_MAX) return { ok: false, error: `Keep the message under ${BODY_MAX} characters.` }
  return { ok: true, subject: s, body: b }
}

// Sent from Mzobs's own address; replies go straight to the recruiter.
export function buildOutreachEmail({ subject, body, recruiterName, companyName, recruiterEmail }) {
  const who = [stripControl(recruiterName).trim(), companyName ? `(${stripControl(companyName).trim()})` : ''].filter(Boolean).join(' ') || 'A recruiter'
  const footer = `Sent by ${who} through Mzobs. Reply to this email to reach ${recruiterEmail ? recruiterEmail : 'them'} directly. You are receiving this because your profile is on Mzobs; if it is not relevant, you can ignore it.`
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#16324f">${escapeHtml(body).replace(/\n/g, '<br>')}</div><hr style="border:none;border-top:1px solid #e6eaf0;margin:24px 0"><p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#64748b">${escapeHtml(footer)}</p>`
  return { subject, text: `${body}\n\n--\n${footer}`, html }
}

export function contactGate(unlock, channel) {
  const part = CHANNEL_PART[channel]
  return { part, ok: !!part && revealedParts(unlock).has(part) }
}

const DEFAULT_DEPS = { sendMail, isMailConfigured, sendSmsFlow, isSmsConfigured }

// Does the whole send and answers with what to reply: { status, json }. The
// senders are injectable so tests never hit SMTP or MSG91.
export async function performOutreach({ company, user, candidate, employee, unlock, channel, subject, body, deps = DEFAULT_DEPS }) {
  const gate = contactGate(unlock, channel)
  if (!gate.ok) {
    const what = gate.part === 'email' ? 'email' : 'phone number'
    return { status: 403, json: { code: 'REVEAL_REQUIRED', part: gate.part, message: `View this candidate's ${what} first — then you can ${channel === 'email' ? 'email' : 'text'} them from here.` } }
  }

  const recent = await OutreachMessage.countDocuments({
    company: company._id,
    candidate: candidate._id,
    channel,
    status: 'sent',
    createdAt: { $gte: new Date(Date.now() - DAY_MS) },
  })
  if (recent >= MAX_PER_CANDIDATE_PER_DAY) {
    return { status: 429, json: { code: 'CANDIDATE_LIMIT', message: `You have already ${channel === 'email' ? 'emailed' : 'texted'} ${firstName(candidate.name)} ${MAX_PER_CANDIDATE_PER_DAY} times today. Try again tomorrow.` } }
  }

  const log = (fields) =>
    OutreachMessage.create({ company: company._id, candidate: candidate._id, employee: candidate.employee ?? null, sentBy: user?._id ?? null, channel, ...fields })
  const fail = async (fields, error) => {
    await log({ status: 'failed', error: String(error?.message ?? error).slice(0, 300), ...fields })
    return { status: 502, json: { code: 'SEND_FAILED', message: `Could not ${channel === 'email' ? 'send the email' : 'send the SMS'} right now. Please try again.` } }
  }

  if (channel === 'email') {
    const content = validateEmailContent({ subject, body })
    if (!content.ok) return { status: 400, json: { code: 'INVALID_MESSAGE', message: content.error } }
    const to = employee?.email || candidate.email
    if (!to) return { status: 422, json: { code: 'NO_EMAIL', message: 'This candidate has no email on file.' } }
    if (!deps.isMailConfigured()) return { status: 503, json: { code: 'EMAIL_NOT_CONFIGURED', message: 'Email sending is not set up on the server yet.' } }
    const mail = buildOutreachEmail({ ...content, recruiterName: user?.name, companyName: company.name, recruiterEmail: user?.email })
    try {
      await deps.sendMail({ to, subject: mail.subject, text: mail.text, html: mail.html, replyTo: user?.email })
    } catch (err) {
      return fail({ subject: mail.subject, body: content.body }, err)
    }
    await log({ status: 'sent', subject: mail.subject, body: content.body })
    return { status: 200, json: { ok: true, channel, sentAt: new Date().toISOString() } }
  }

  if (!deps.isSmsConfigured()) return { status: 503, json: { code: 'SMS_NOT_CONFIGURED', message: 'SMS is not set up yet. Ask an admin to add the SMS template.' } }
  const mobile = normalizeMobile(employee?.phone || candidate.phone)
  if (!mobile) return { status: 422, json: { code: 'NO_PHONE', message: "This candidate's number is not a valid Indian mobile, so no SMS can be sent." } }
  const vars = smsVariables({ candidateName: candidate.name, companyName: company.name })
  let providerRef = null
  try {
    providerRef = await deps.sendSmsFlow(mobile, vars)
  } catch (err) {
    return fail({ body: smsText(vars) }, err)
  }
  await log({ status: 'sent', body: smsText(vars), providerRef: String(providerRef ?? '') })
  return { status: 200, json: { ok: true, channel, sentAt: new Date().toISOString() } }
}
