process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'unit-test-secret'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
const { generatePhoneOtp, hashPhoneOtp, phoneOtpMatches } = await import('./phoneOtp.js')

describe('phone OTP helpers', () => {
  test('codes are always 6 digits', () => {
    for (let i = 0; i < 200; i++) assert.match(generatePhoneOtp(), /^\d{6}$/)
  })

  test('a code only matches its own number and value', () => {
    const hash = hashPhoneOtp('9876543210', '123456')
    assert.ok(phoneOtpMatches('9876543210', '123456', hash))
    assert.ok(phoneOtpMatches(' 9876543210 ', '123456', hash), 'number is trimmed')
    assert.ok(!phoneOtpMatches('9876543210', '654321', hash))
    assert.ok(!phoneOtpMatches('9123456780', '123456', hash))
    assert.ok(!phoneOtpMatches('9876543210', '123456', 'not-hex'))
  })

  test('the stored value is not the code', () => {
    assert.ok(!hashPhoneOtp('9876543210', '123456').includes('123456'))
  })
})
