process.env.MONGO_URI ??= 'mongodb://127.0.0.1:27017/unused'
process.env.JWT_SECRET ??= 'unit-test-secret'
process.env.REVIEW_LOGIN_PHONE = '9000000001'
process.env.REVIEW_LOGIN_OTP = '123456'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
const { isReviewLoginEnabled, isReviewPhone, isReviewAccount, reviewOtpMatches, REVIEW_EMAIL } = await import('./reviewLogin.js')

describe('app-review login', () => {
  test('is on when both the number and the OTP are configured', () => {
    assert.equal(isReviewLoginEnabled(), true)
  })

  test('only the reserved number is treated as the review number', () => {
    assert.equal(isReviewPhone('9000000001'), true)
    assert.equal(isReviewPhone(' 9000000001 '), true)
    assert.equal(isReviewPhone('9000000002'), false)
    assert.equal(isReviewPhone(undefined), false)
    assert.equal(isReviewPhone(9000000001), false)
  })

  test('OTP must match exactly', () => {
    assert.equal(reviewOtpMatches('123456'), true)
    assert.equal(reviewOtpMatches(' 123456 '), true)
    assert.equal(reviewOtpMatches('654321'), false)
    assert.equal(reviewOtpMatches(''), false)
    assert.equal(reviewOtpMatches(undefined), false)
    assert.equal(reviewOtpMatches(123456), false)
  })

  test('the review account is recognised by its reserved email only', () => {
    assert.equal(isReviewAccount({ email: REVIEW_EMAIL }), true)
    assert.equal(isReviewAccount({ email: 'someone@x.io' }), false)
    assert.equal(isReviewAccount(null), false)
  })
})
