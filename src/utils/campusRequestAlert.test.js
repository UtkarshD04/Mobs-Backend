import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/test'
process.env.JWT_SECRET ??= 'test-secret'

const { parseEmailList, buildCampusRequestEmail, alertNewCampusRequest } = await import('./campusRequestAlert.js')

const request = {
  campusName: 'Govt. Polytechnic <Lucknow>',
  institutionType: 'Polytechnic',
  city: 'Lucknow',
  state: 'Uttar Pradesh',
  contactPerson: 'A. Sharma',
  officialEmail: 'tpo@gpl.ac.in',
  phone: '9876543210',
  website: '',
  message: 'Line one\nLine two',
}
const silentLog = { warn() {}, error() {} }

function harness(overrides = {}) {
  const sent = []
  const notified = []
  const deps = {
    findAdmins: async () => [{ _id: 'a1', email: 'Admin1@mzobs.com' }, { _id: 'a2', email: 'admin2@mzobs.com' }],
    mail: async (m) => { sent.push(m) },
    notify: async (staff, n) => { notified.push({ staff: staff._id, ...n }) },
    configuredEmails: '',
    opsUrl: 'https://ops.mzobs.com/',
    log: silentLog,
    ...overrides,
  }
  return { deps, sent, notified }
}

test('parseEmailList splits, lowercases, dedupes and drops invalid entries', () => {
  assert.deepEqual(parseEmailList('A@x.com, b@y.in;a@x.com  not-an-email'), ['a@x.com', 'b@y.in'])
  assert.deepEqual(parseEmailList(''), [])
})

test('email escapes HTML, links to the ops page, skips empty fields and replies to the college', () => {
  const m = buildCampusRequestEmail(request, { opsUrl: 'https://ops.mzobs.com/' })
  assert.equal(m.subject, 'New campus request: Govt. Polytechnic <Lucknow>')
  assert.match(m.html, /Govt\. Polytechnic &lt;Lucknow&gt;/)
  assert.doesNotMatch(m.html, /<Lucknow>/)
  assert.match(m.html, /https:\/\/ops\.mzobs\.com\/app\/campus-requests/)
  assert.match(m.html, /Line one<br>Line two/)
  assert.doesNotMatch(m.text, /Website:/)
  assert.match(m.text, /Location: Lucknow, Uttar Pradesh/)
  assert.equal(m.replyTo, 'tpo@gpl.ac.in')
})

test('emails the configured list when set, and notifies every admin in-app', async () => {
  const { deps, sent, notified } = harness({ configuredEmails: 'ops@mzobs.com, partnerships@mzobs.com' })
  await alertNewCampusRequest(request, deps)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'ops@mzobs.com, partnerships@mzobs.com')
  assert.deepEqual(notified.map((n) => n.staff), ['a1', 'a2'])
  assert.equal(notified[0].category, 'campus-requests')
  assert.match(notified[0].body, /Lucknow, Uttar Pradesh/)
})

test('falls back to emailing active admins when no list is configured', async () => {
  const { deps, sent } = harness()
  await alertNewCampusRequest(request, deps)
  assert.equal(sent[0].to, 'admin1@mzobs.com, admin2@mzobs.com')
})

test('a failing email or staff lookup never throws', async () => {
  const { deps, notified } = harness({ mail: async () => { throw new Error('smtp down') } })
  await assert.doesNotReject(alertNewCampusRequest(request, deps))
  assert.equal(notified.length, 2)

  const noAdmins = harness({ findAdmins: async () => { throw new Error('db down') }, configuredEmails: 'ops@mzobs.com' })
  await assert.doesNotReject(alertNewCampusRequest(request, noAdmins.deps))
  assert.equal(noAdmins.sent.length, 1)
})
