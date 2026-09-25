import 'dotenv/config'
import { test, describe, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import OutreachMessage from '../models/OutreachMessage.js'
import {
  MAX_PER_CANDIDATE_PER_DAY,
  SMS_TEMPLATE_TEXT,
  normalizeMobile,
  smsVariables,
  smsText,
  validateEmailContent,
  buildOutreachEmail,
  contactGate,
  performOutreach,
} from './outreach.js'

// Integration tests against a real, disposable local MongoDB (same approach as
// creditWallet.test.js). Mail and SMS are faked — nothing is ever sent.
const TEST_MONGO_URI = process.env.CV_CREDIT_TEST_MONGO_URI ?? 'mongodb://127.0.0.1:27017/mzobs_outreach_test'

before(async () => {
  await mongoose.connect(TEST_MONGO_URI)
})
after(async () => {
  await mongoose.connection.dropDatabase()
  await mongoose.disconnect()
})
beforeEach(async () => {
  await OutreachMessage.deleteMany({})
})

describe('normalizeMobile', () => {
  test('accepts the usual ways an Indian mobile is stored', () => {
    for (const v of ['9876543210', '+91 98765 43210', '919876543210', '09876543210', ' 98765-43210 ']) assert.equal(normalizeMobile(v), '9876543210', v)
  })
  test('rejects anything that is not a 10-digit mobile starting 6-9', () => {
    for (const v of ['', null, undefined, '12345', '5876543210', '98765432101234', 'abcdefghij', '+1 415 555 0100']) assert.equal(normalizeMobile(v), null, String(v))
  })
})

describe('SMS text', () => {
  test('variables are short and safe; the text is the registered template with them filled in', () => {
    const vars = smsVariables({ candidateName: '  Ankit   Kumar Nishad ', companyName: 'A Really Very Long Company Name Private Limited' })
    assert.equal(vars.name, 'Ankit')
    assert.ok(vars.company.length <= 25)
    assert.equal(smsText(vars), SMS_TEMPLATE_TEXT.replace('##name##', 'Ankit').replace('##company##', vars.company))
    assert.doesNotMatch(smsText(vars), /##/)
  })
  test('a missing name falls back rather than sending "Hi undefined"', () => {
    assert.equal(smsVariables({ candidateName: '', companyName: 'Acme' }).name, 'there')
  })
})

describe('email content', () => {
  test('needs a subject and a message, within limits', () => {
    assert.equal(validateEmailContent({ subject: '', body: 'hi' }).ok, false)
    assert.equal(validateEmailContent({ subject: 'x', body: '   ' }).ok, false)
    assert.equal(validateEmailContent({ subject: 'x'.repeat(151), body: 'hi' }).ok, false)
    assert.equal(validateEmailContent({ subject: 'x', body: 'y'.repeat(5001) }).ok, false)
    assert.deepEqual(validateEmailContent({ subject: ' Hello ', body: ' Hi there ' }), { ok: true, subject: 'Hello', body: 'Hi there' })
  })
  test('a subject cannot smuggle in extra headers through line breaks', () => {
    assert.equal(validateEmailContent({ subject: 'Hello\r\nBcc: everyone@example.com', body: 'hi' }).subject, 'Hello Bcc: everyone@example.com')
  })
  test('the HTML escapes what the recruiter typed, and replies are pointed at them', () => {
    const mail = buildOutreachEmail({ subject: 'Hi', body: '<script>alert(1)</script>\nSecond line', recruiterName: 'Asha', companyName: 'Acme', recruiterEmail: 'asha@acme.com' })
    assert.doesNotMatch(mail.html, /<script>/)
    assert.match(mail.html, /&lt;script&gt;/)
    assert.match(mail.html, /<br>/)
    assert.match(mail.text, /Sent by Asha \(Acme\) through Mzobs/)
    assert.match(mail.text, /asha@acme\.com/)
  })
})

describe('contactGate: a channel needs the part it uses', () => {
  test('email needs the email revealed, sms needs the phone', () => {
    assert.equal(contactGate({ revealed: ['email'] }, 'email').ok, true)
    assert.equal(contactGate({ revealed: ['email'] }, 'sms').ok, false)
    assert.equal(contactGate({ revealed: ['phone'] }, 'sms').ok, true)
    assert.equal(contactGate({ revealed: ['phone'] }, 'email').ok, false)
    assert.equal(contactGate({ revealed: ['resume'] }, 'email').ok, false)
  })
  test('no unlock at all → nothing allowed; an older all-open unlock → everything', () => {
    assert.equal(contactGate(null, 'email').ok, false)
    assert.equal(contactGate({}, 'sms').ok, true)
  })
})

describe('performOutreach', () => {
  const company = { _id: new mongoose.Types.ObjectId(), name: 'Acme Hiring' }
  const user = { _id: new mongoose.Types.ObjectId(), name: 'Asha', email: 'asha@acme.com' }
  const candidate = () => ({ _id: new mongoose.Types.ObjectId(), name: 'Ankit Nishad', employee: new mongoose.Types.ObjectId(), email: 'stale@old.com', phone: '9000000000' })
  const employee = { email: 'ankit@gmail.com', phone: '+91 98765 43210' }
  const fakes = (over = {}) => {
    const calls = { mail: [], sms: [] }
    return {
      calls,
      deps: {
        isMailConfigured: () => true,
        isSmsConfigured: () => true,
        sendMail: async (m) => void calls.mail.push(m),
        sendSmsFlow: async (phone, vars) => (calls.sms.push({ phone, vars }), 'req-123'),
        ...over,
      },
    }
  }
  const base = (c, deps, extra = {}) => ({ company, user, candidate: c, employee, unlock: { revealed: ['email', 'phone'] }, channel: 'email', subject: 'Job for you', body: 'Hello Ankit', deps, ...extra })

  test('email: sent to the candidate\'s current address, replies go to the recruiter, and it is logged', async () => {
    const { calls, deps } = fakes()
    const c = candidate()
    const r = await performOutreach(base(c, deps))

    assert.equal(r.status, 200)
    assert.equal(calls.mail.length, 1)
    assert.equal(calls.mail[0].to, 'ankit@gmail.com', 'the live Employee email, not the stale snapshot')
    assert.equal(calls.mail[0].replyTo, 'asha@acme.com')
    assert.equal(calls.mail[0].subject, 'Job for you')
    const [row] = await OutreachMessage.find({ candidate: c._id })
    assert.equal(row.status, 'sent')
    assert.equal(row.channel, 'email')
    assert.equal(String(row.sentBy), String(user._id))
  })

  test('sms: the fixed template goes to the normalised number, with only the two variables', async () => {
    const { calls, deps } = fakes()
    const r = await performOutreach(base(candidate(), deps, { channel: 'sms', body: 'ignored free text' }))

    assert.equal(r.status, 200)
    assert.deepEqual(calls.sms, [{ phone: '9876543210', vars: { name: 'Ankit', company: 'Acme Hiring' } }])
    const [row] = await OutreachMessage.find({})
    assert.equal(row.providerRef, 'req-123')
    assert.doesNotMatch(row.body, /ignored free text/)
  })

  test('a part that has not been viewed blocks the send and sends nothing', async () => {
    const { calls, deps } = fakes()
    const c = candidate()

    const email = await performOutreach(base(c, deps, { unlock: { revealed: ['phone'] } }))
    const sms = await performOutreach(base(c, deps, { channel: 'sms', unlock: { revealed: ['email'] } }))
    const none = await performOutreach(base(c, deps, { unlock: null }))

    assert.deepEqual([email.status, sms.status, none.status], [403, 403, 403])
    assert.equal(email.json.code, 'REVEAL_REQUIRED')
    assert.equal(email.json.part, 'email')
    assert.equal(sms.json.part, 'phone')
    assert.equal(calls.mail.length + calls.sms.length, 0)
    assert.equal(await OutreachMessage.countDocuments({}), 0)
  })

  test(`at most ${MAX_PER_CANDIDATE_PER_DAY} messages per candidate per channel per day`, async () => {
    const { calls, deps } = fakes()
    const c = candidate()
    for (let i = 0; i < MAX_PER_CANDIDATE_PER_DAY; i++) assert.equal((await performOutreach(base(c, deps))).status, 200)

    const over = await performOutreach(base(c, deps))
    assert.equal(over.status, 429)
    assert.equal(calls.mail.length, MAX_PER_CANDIDATE_PER_DAY)

    // another channel, another candidate, and another company are each unaffected
    assert.equal((await performOutreach(base(c, deps, { channel: 'sms' }))).status, 200)
    assert.equal((await performOutreach(base(candidate(), deps))).status, 200)
    assert.equal((await performOutreach(base(c, deps, { company: { _id: new mongoose.Types.ObjectId(), name: 'Other' } }))).status, 200)
  })

  test('messages older than a day no longer count against the cap', async () => {
    const { deps } = fakes()
    const c = candidate()
    for (let i = 0; i < MAX_PER_CANDIDATE_PER_DAY; i++) await performOutreach(base(c, deps))
    // createdAt is immutable through Mongoose, so age the rows with the raw driver
    await OutreachMessage.collection.updateMany({ candidate: c._id }, { $set: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } })

    assert.equal((await performOutreach(base(c, deps))).status, 200)
  })

  test('a provider failure is logged as failed, does not count toward the cap, and says so', async () => {
    const { deps } = fakes({ sendMail: async () => { throw new Error('SMTP down') } })
    const c = candidate()

    const r = await performOutreach(base(c, deps))

    assert.equal(r.status, 502)
    assert.equal(r.json.code, 'SEND_FAILED')
    const [row] = await OutreachMessage.find({ candidate: c._id })
    assert.equal(row.status, 'failed')
    assert.match(row.error, /SMTP down/)
    for (let i = 0; i < MAX_PER_CANDIDATE_PER_DAY; i++) assert.equal((await performOutreach(base(c, fakes().deps))).status, 200)
  })

  test('not configured → a clear 503, never a fake "sent"', async () => {
    const c = candidate()
    const mail = await performOutreach(base(c, fakes({ isMailConfigured: () => false }).deps))
    const sms = await performOutreach(base(c, fakes({ isSmsConfigured: () => false }).deps, { channel: 'sms' }))

    assert.deepEqual([mail.status, sms.status], [503, 503])
    assert.equal(mail.json.code, 'EMAIL_NOT_CONFIGURED')
    assert.equal(sms.json.code, 'SMS_NOT_CONFIGURED')
    assert.equal(await OutreachMessage.countDocuments({}), 0)
  })

  test('bad input and unusable contact details are rejected before anything is sent', async () => {
    const { calls, deps } = fakes()
    const c = candidate()

    assert.equal((await performOutreach(base(c, deps, { subject: '', body: 'x' }))).status, 400)
    assert.equal((await performOutreach(base(c, deps, { employee: { email: '', phone: '' }, candidate: { ...c, email: '', phone: '' } }))).status, 422)
    assert.equal((await performOutreach(base(c, deps, { channel: 'sms', employee: { phone: '12345' }, candidate: { ...c, phone: '12345' } }))).json.code, 'NO_PHONE')
    assert.equal(calls.mail.length + calls.sms.length, 0)
  })
})
