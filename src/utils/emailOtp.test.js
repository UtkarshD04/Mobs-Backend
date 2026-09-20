process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'unit-test-secret'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
const { generateEmailOtp, hashEmailOtp, emailOtpMatches, issueEmailToken, checkEmailToken, EMAIL_RE } = await import('./emailOtp.js')

describe('email OTP helpers', () => {
  test('codes are always 6 digits', () => {
    for (let i = 0; i < 200; i++) assert.match(generateEmailOtp(), /^\d{6}$/)
  })

  test('a code only matches its own address and value', () => {
    const hash = hashEmailOtp('a@x.io', '123456')
    assert.ok(emailOtpMatches('a@x.io', '123456', hash))
    assert.ok(emailOtpMatches('A@X.io ', '123456', hash), 'address is normalised')
    assert.ok(!emailOtpMatches('a@x.io', '654321', hash))
    assert.ok(!emailOtpMatches('b@x.io', '123456', hash))
    assert.ok(!emailOtpMatches('a@x.io', '123456', 'not-hex'))
  })

  test('email token proves one address and cannot be reused for another', () => {
    const token = issueEmailToken('Me@X.io')
    assert.ok(checkEmailToken(token, 'me@x.io'))
    assert.ok(!checkEmailToken(token, 'other@x.io'))
    assert.ok(!checkEmailToken('garbage', 'me@x.io'))
  })

  test('email validation', () => {
    assert.ok(EMAIL_RE.test('a@b.co'))
    assert.ok(!EMAIL_RE.test('a@b'))
    assert.ok(!EMAIL_RE.test('a b@c.io'))
  })
})
