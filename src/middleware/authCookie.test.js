process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'unit-test-secret'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
const { authCookies, audienceOf, readCookie, logout } = await import('./authCookie.js')

const token = jwt.sign({ sub: 'u1', type: 'staff' }, process.env.JWT_SECRET, { expiresIn: '1h' })

function fakeRes() {
  const res = {
    statusCode: 200,
    cookies: [],
    cleared: [],
    body: undefined,
    cookie(name, value, opts) { this.cookies.push({ name, value, opts }); return this },
    clearCookie(name, opts) { this.cleared.push({ name, opts }); return this },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
  }
  return res
}
const run = (req, res = fakeRes()) => {
  let nexted = false
  authCookies({ headers: {}, method: 'GET', ...req }, res, () => { nexted = true })
  return { res, nexted }
}

describe('audienceOf', () => {
  test('maps the API prefixes and ignores everything else', () => {
    assert.equal(audienceOf('/api/staff/jobs'), 'staff')
    assert.equal(audienceOf('/api/employee/auth/login'), 'employee')
    assert.equal(audienceOf('/api/employer'), 'employer')
    assert.equal(audienceOf('/api/employers-x'), null)
    assert.equal(audienceOf('/api/jobs'), null)
  })
})

describe('readCookie', () => {
  test('finds a cookie among several and decodes it', () => {
    assert.equal(readCookie({ headers: { cookie: 'a=1; mzobs_staff=x%20y; b=2' } }, 'mzobs_staff'), 'x y')
    assert.equal(readCookie({ headers: {} }, 'mzobs_staff'), null)
  })
})

describe('cookie session -> Authorization', () => {
  test('a GET with the audience cookie gets a Bearer header', () => {
    const req = { originalUrl: '/api/staff/jobs', headers: { cookie: `mzobs_staff=${token}` } }
    run(req)
    assert.equal(req.headers.authorization, `Bearer ${token}`)
  })
  test('another audience\'s cookie is not used', () => {
    const req = { originalUrl: '/api/employee/profile', headers: { cookie: `mzobs_staff=${token}` } }
    run(req)
    assert.equal(req.headers.authorization, undefined)
  })
  test('a cookie-authenticated write without the client header is refused (CSRF)', () => {
    const req = { originalUrl: '/api/staff/jobs', method: 'POST', headers: { cookie: `mzobs_staff=${token}` } }
    const { res, nexted } = run(req)
    assert.equal(nexted, false)
    assert.equal(res.statusCode, 403)
  })
  test('the same write with the client header goes through', () => {
    const req = { originalUrl: '/api/staff/jobs', method: 'POST', headers: { cookie: `mzobs_staff=${token}`, 'x-requested-with': 'mzobs-web' } }
    const { nexted } = run(req)
    assert.equal(nexted, true)
    assert.equal(req.headers.authorization, `Bearer ${token}`)
  })
  test('an explicit Bearer header (native apps) is left alone and needs no marker', () => {
    const req = { originalUrl: '/api/staff/jobs', method: 'POST', headers: { authorization: 'Bearer abc', cookie: `mzobs_staff=${token}` } }
    const { nexted } = run(req)
    assert.equal(nexted, true)
    assert.equal(req.headers.authorization, 'Bearer abc')
  })
})

describe('login responses', () => {
  const login = (headers) => {
    const req = { originalUrl: '/api/staff/auth/login', method: 'POST', headers }
    const res = fakeRes()
    run(req, res)
    res.json({ token, staff: { id: 'u1' } })
    return res
  }
  test('web client: httpOnly cookie is set and the token is not in the body', () => {
    const res = login({ 'x-requested-with': 'mzobs-web' })
    assert.equal(res.cookies[0].name, 'mzobs_staff')
    assert.equal(res.cookies[0].value, token)
    assert.equal(res.cookies[0].opts.httpOnly, true)
    assert.equal(res.cookies[0].opts.sameSite, 'lax')
    assert.ok(res.cookies[0].opts.maxAge > 0)
    assert.equal(res.body.token, undefined)
    assert.deepEqual(res.body.staff, { id: 'u1' })
  })
  test('native client: body keeps the token (cookie is harmless)', () => {
    const res = login({})
    assert.equal(res.body.token, token)
  })
  test('failed logins set nothing', () => {
    const req = { originalUrl: '/api/staff/auth/login', method: 'POST', headers: {} }
    const res = fakeRes()
    run(req, res)
    res.status(401).json({ message: 'nope', token: 'x' })
    assert.equal(res.cookies.length, 0)
  })
  test('logout clears the audience cookie', () => {
    const res = fakeRes()
    logout('employer')({}, res)
    assert.equal(res.cleared[0].name, 'mzobs_employer')
    assert.deepEqual(res.body, { ok: true })
  })
})
