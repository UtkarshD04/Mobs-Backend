process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'unit-test-secret'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
const { buildInterviewEmail, formatWhen, interviewEmailGate, maskEmail, safeLink, sendInterviewEmail } = await import('./interviewEmail.js')

const base = {
  candidateName: 'Asha Rao',
  companyName: 'Acme Analytics',
  role: 'Data Analyst',
  round: 'Technical',
  startsAt: '2030-01-15T06:00:00.000Z', // 11:30 am IST
  durationMins: 45,
  mode: 'Video Call',
  meetingLink: 'https://meet.example.com/abc',
  panel: ['Priya', 'Sam'],
  recruiterName: 'Priya Recruiter',
  recruiterEmail: 'priya@acme.test',
}

describe('formatWhen', () => {
  test('formats the date and time range in IST', () => {
    const when = formatWhen(base.startsAt, 45)
    assert.match(when.date, /Tuesday/)
    assert.match(when.date, /15 January 2030/)
    assert.equal(when.time, '11:30 am – 12:15 pm')
    assert.equal(when.zone, 'IST')
  })
})

describe('buildInterviewEmail', () => {
  test('an invitation carries every detail and a join button', () => {
    const mail = buildInterviewEmail('scheduled', base)
    assert.equal(mail.subject, 'Interview invitation: Data Analyst at Acme Analytics')
    for (const part of ['Asha', 'Technical', '11:30 am – 12:15 pm', 'Priya, Sam', 'Video call']) assert.ok(mail.html.includes(part) && mail.text.includes(part.replace('&amp;', '&')), part)
    assert.ok(mail.html.includes('href="https://meet.example.com/abc"'))
    assert.match(mail.text, /Join: https:\/\/meet\.example\.com\/abc/)
    assert.match(mail.text, /Reply to this email to reach priya@acme\.test/)
  })

  test('on-site shows the location and no join button', () => {
    const mail = buildInterviewEmail('scheduled', { ...base, mode: 'On-site', location: '401 Experio Building, Lucknow', meetingLink: null })
    assert.match(mail.text, /Location: 401 Experio Building, Lucknow/)
    assert.ok(!mail.html.includes('Join the interview'))
  })

  test('rescheduled and cancelled say so, and a cancellation has no join link', () => {
    assert.match(buildInterviewEmail('rescheduled', base).subject, /^New interview time/)
    const cancelled = buildInterviewEmail('cancelled', base)
    assert.match(cancelled.subject, /^Interview cancelled/)
    assert.ok(!cancelled.html.includes('Join the interview'))
    assert.ok(!cancelled.text.includes('Join:'))
  })

  test('recruiter-supplied text is escaped and unsafe links are dropped', () => {
    const mail = buildInterviewEmail('scheduled', { ...base, candidateName: '<script>alert(1)</script> Asha', panel: ['<b>Evil</b>'], meetingLink: 'javascript:alert(1)' })
    assert.ok(!mail.html.includes('<script>'))
    assert.ok(!mail.html.includes('<b>Evil</b>'))
    assert.ok(!mail.html.includes('javascript:'))
    assert.ok(!mail.html.includes('Join the interview'))
    assert.match(mail.html, /Video call \(link to follow\)/)
  })
})

describe('safeLink', () => {
  test('only http and https links pass', () => {
    assert.equal(safeLink('https://meet.example.com/x'), 'https://meet.example.com/x')
    assert.equal(safeLink('http://a.test'), 'http://a.test/')
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.test', 'not a url', '', null, undefined]) assert.equal(safeLink(bad), null, String(bad))
  })
})

describe('who may be emailed', () => {
  test('someone who applied, or whose email was unlocked — not an unlocked-nothing database profile', () => {
    assert.equal(interviewEmailGate({ candidate: { application: 'app1' }, unlock: null }), true)
    assert.equal(interviewEmailGate({ candidate: { application: null }, unlock: { revealed: ['email'] } }), true)
    assert.equal(interviewEmailGate({ candidate: { application: null }, unlock: { revealed: ['phone'] } }), false)
    assert.equal(interviewEmailGate({ candidate: { application: null }, unlock: null }), false)
  })

  test('addresses are masked in anything shown back to the recruiter', () => {
    assert.equal(maskEmail('asha@example.com'), 'a***@example.com')
    assert.equal(maskEmail('nope'), null)
  })
})

describe('sendInterviewEmail', () => {
  const interview = { candidateName: 'Asha Rao', role: 'Data Analyst', startsAt: base.startsAt, durationMins: 45, mode: 'Video Call', meetingLink: base.meetingLink, panel: [] }
  const company = { name: 'Acme Analytics' }
  const user = { name: 'Priya Recruiter', email: 'priya@acme.test' }
  const candidate = { name: 'Asha Rao', application: 'app1', email: 'private@candidate.test' }
  const sender = () => {
    const calls = []
    return { calls, deps: { isMailConfigured: () => true, sendMail: async (m) => calls.push(m) } }
  }

  test('sends once to the candidate with replies to the recruiter, and reports a masked address', async () => {
    const { calls, deps } = sender()
    const out = await sendInterviewEmail({ kind: 'scheduled', interview, candidate, employee: { email: 'asha@example.com' }, unlock: null, company, user, deps })
    assert.equal(out.status, 'sent')
    assert.equal(out.to, 'a***@example.com')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].to, 'asha@example.com')
    assert.equal(calls[0].replyTo, 'priya@acme.test')
    assert.ok(calls[0].html && calls[0].text)
  })

  test('each refusal is reported plainly and nothing is sent', async () => {
    const { calls, deps } = sender()
    assert.equal((await sendInterviewEmail({ kind: 'scheduled', interview, candidate: { ...candidate, application: null }, unlock: null, company, user, deps })).status, 'not_allowed')
    assert.equal((await sendInterviewEmail({ kind: 'scheduled', interview, candidate: { ...candidate, email: '' }, employee: null, unlock: null, company, user, deps })).status, 'no_email')
    assert.equal((await sendInterviewEmail({ kind: 'scheduled', interview, candidate, unlock: null, company, user, deps: { ...deps, isMailConfigured: () => false } })).status, 'not_configured')
    assert.equal((await sendInterviewEmail({ kind: 'bogus', interview, candidate, company, user, deps })).status, 'failed')
    assert.equal(calls.length, 0)
  })

  test('a mail server error becomes a failed result instead of throwing', async () => {
    const out = await sendInterviewEmail({ kind: 'scheduled', interview, candidate, employee: { email: 'asha@example.com' }, unlock: null, company, user, deps: { isMailConfigured: () => true, sendMail: async () => { throw new Error('SMTP down') } } })
    assert.equal(out.status, 'failed')
    assert.equal(out.error, 'SMTP down')
  })
})
