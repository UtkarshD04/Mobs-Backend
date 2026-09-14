import 'dotenv/config'
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { redactCandidate, maskEmail, maskPhone } from './candidateController.js'

function fakeCandidate(overrides = {}) {
  return {
    toJSON() {
      return { id: 'cand_1', name: 'Jordan Rivera', email: 'jordan.rivera@example.com', phone: '+919876543210', ...overrides }
    },
  }
}

describe('redactCandidate — pre-unlock response never leaks private data', () => {
  test('unlocked=false strips email, phone and resumeUrl entirely', () => {
    const out = redactCandidate(fakeCandidate(), false)
    assert.equal(out.email, null)
    assert.equal(out.phone, null)
    assert.equal(out.resumeUrl, null)
    assert.equal(out.unlocked, false)
  })

  test('unlocked=false still exposes a masked contact preview, never the real value', () => {
    const out = redactCandidate(fakeCandidate(), false)
    assert.equal(out.contactPreview.email, 'j************@example.com')
    assert.ok(out.contactPreview.phone.endsWith('3210'))
    assert.doesNotMatch(out.contactPreview.email, /jordan\.rivera/)
    assert.doesNotMatch(out.contactPreview.phone, /98765432/)
  })

  test('unlocked=true restores the real email and phone', () => {
    const out = redactCandidate(fakeCandidate(), true)
    assert.equal(out.email, 'jordan.rivera@example.com')
    assert.equal(out.phone, '+919876543210')
    assert.equal(out.unlocked, true)
  })

  test('a candidate with no email/phone on file redacts to null without throwing', () => {
    const out = redactCandidate(fakeCandidate({ email: '', phone: '' }), false)
    assert.equal(out.contactPreview.email, null)
    assert.equal(out.contactPreview.phone, null)
  })
})

describe('maskEmail / maskPhone', () => {
  test('maskEmail keeps only the first character of the local part', () => {
    assert.equal(maskEmail('alex@company.com'), 'a***@company.com')
    assert.equal(maskEmail(''), null)
    assert.equal(maskEmail(null), null)
  })

  test('maskPhone keeps only the last four digits', () => {
    assert.equal(maskPhone('+91 98765 43210'), '********3210')
    assert.equal(maskPhone(''), null)
  })
})
